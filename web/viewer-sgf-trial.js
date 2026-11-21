/* SGF Trial/Research Engine: self-contained sandbox for Go rule validation,
 * undo/redo history, ko detection, and state isolation without modifying the SGF tree.
 */
(function () {
  const BLACK = 1, WHITE = 2;
  const engine = (typeof window !== 'undefined' ? window.GoSgfEngine : globalThis.GoSgfEngine) || {};

  function cloneState(s) {
    return {
      cells: new Uint8Array(s.cells),
      numbers: new Uint16Array(s.numbers),
      captures: { B: s.captures?.B || 0, W: s.captures?.W || 0 },
      lastMove: s.lastMove ? { ...s.lastMove } : null,
      moveNumber: s.moveNumber || 0,
      toMove: s.toMove || 'B',
      error: s.error || null,
      errorNode: s.errorNode || null,
    };
  }

  function inside(size, x, y) {
    return x >= 0 && y >= 0 && x < size && y < size;
  }

  function index(size, x, y) {
    return y * size + x;
  }

  function colourAt(size, state, x, y) {
    return !inside(size, x, y) ? 0 : state.cells[index(size, x, y)];
  }

  function group(size, state, x, y) {
    const colour = colourAt(size, state, x, y);
    if (!colour) return { points: [], liberties: new Set() };
    const points = [], liberties = new Set(), seen = new Set([`${x},${y}`]), queue = [[x, y]];
    while (queue.length) {
      const [cx, cy] = queue.shift();
      points.push([cx, cy]);
      for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
        if (!inside(size, nx, ny)) continue;
        const val = colourAt(size, state, nx, ny);
        const key = `${nx},${ny}`;
        if (!val) {
          liberties.add(key);
        } else if (val === colour && !seen.has(key)) {
          seen.add(key);
          queue.push([nx, ny]);
        }
      }
    }
    return { points, liberties };
  }

  /**
   * Determine whether node in SGF tree just captured a single ko stone.
   * If so, returns the point {x, y} that cannot be immediately recaptured.
   */
  function detectOriginKo(tree, navigator, nodeId, boardSize) {
    if (!tree || !navigator || !nodeId) return null;
    const node = tree.nodes[nodeId];
    if (!node || !node.move || node.move.pass) return null;
    if (!node.parent) return null;

    try {
      const parentState = navigator.stateAt(node.parent);
      if (parentState.error) return null;

      const m = node.move;
      const colour = m.color === 'B' ? BLACK : WHITE;
      const opponent = colour === BLACK ? WHITE : BLACK;

      // Check captured stones when node move was played
      // In parentState, m.x, m.y was empty
      if (parentState.cells[index(boardSize, m.x, m.y)] !== 0) return null;

      // Simulate placing stone on parentState clone
      const sim = cloneState(parentState);
      sim.cells[index(boardSize, m.x, m.y)] = colour;

      const captures = [];
      const checked = new Set();
      for (const [nx, ny] of [[m.x - 1, m.y], [m.x + 1, m.y], [m.x, m.y - 1], [m.x, m.y + 1]]) {
        if (!inside(boardSize, nx, ny) || sim.cells[index(boardSize, nx, ny)] !== opponent) continue;
        const key = `${nx},${ny}`;
        if (checked.has(key)) continue;
        const grp = group(boardSize, sim, nx, ny);
        grp.points.forEach(([px, py]) => checked.add(`${px},${py}`));
        if (!grp.liberties.size) captures.push(...grp.points);
      }

      // Single ko definition: captures exactly 1 stone, and the placed stone's group has only 1 stone and 1 liberty
      if (captures.length === 1) {
        // remove the captured stone
        sim.cells[index(boardSize, captures[0][0], captures[0][1])] = 0;
        const own = group(boardSize, sim, m.x, m.y);
        if (own.points.length === 1 && own.liberties.size === 1) {
          const onlyLib = own.liberties.values().next().value;
          const [lx, ly] = onlyLib.split(',').map(Number);
          if (lx === captures[0][0] && ly === captures[0][1]) {
            return { x: captures[0][0], y: captures[0][1] };
          }
        }
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  /**
   * TrialSession manages a single linear sandbox trial branch.
   */
  class TrialSession {
    constructor(options) {
      this.boardSize = options.boardSize || 19;
      this.matchId = options.matchId || null;
      this.originNodeId = options.nodeId || null;
      this.originMoveNumber = options.moveNumber || 0;
      this.originPathDesc = options.pathDesc || '实战主线';
      this.originComment = options.comment || '';
      this.branchSelectionsSnapshot = { ...(options.branchSelections || {}) };

      // Root state of the trial (deep clone)
      this.rootState = cloneState(options.initialState);
      this.initialKoPoint = options.initialKoPoint || null;

      // History steps: step 0 is the root state (trial move 0)
      this.steps = [{
        move: null, // null for root
        state: this.rootState,
        koPoint: this.initialKoPoint,
        isPass: false,
        desc: `起点：原谱第 ${this.originMoveNumber} 手`
      }];

      // Current position in the trial line (0 = origin, k = trial move k)
      this.cursor = 0;

      // Interaction helpers
      this.pendingMobilePoint = null; // {x, y}
      this.keyboardCursor = { x: Math.floor(this.boardSize / 2), y: Math.floor(this.boardSize / 2) };
      this.lastNotice = '';
    }

    get currentStep() {
      return this.steps[this.cursor];
    }

    get currentState() {
      return this.currentStep.state;
    }

    get trialMoveCount() {
      return this.cursor;
    }

    get totalTrialSteps() {
      return this.steps.length - 1;
    }

    hasTrialMoves() {
      return this.steps.length > 1;
    }

    canUndo() {
      return this.cursor > 0;
    }

    canRedo() {
      return this.cursor < this.steps.length - 1;
    }

    /**
     * Test whether a move at (x, y) for current toMove is legal.
     * Returns { legal: boolean, reason?: string, captures?: Array, nextKoPoint?: {x, y} }
     */
    validateMove(x, y) {
      if (!inside(this.boardSize, x, y)) {
        return { legal: false, reason: '落点超出棋盘。' };
      }
      const curState = this.currentState;
      const idx = index(this.boardSize, x, y);
      if (curState.cells[idx] !== 0) {
        return { legal: false, reason: '该交叉点已有棋子。' };
      }

      // Ko rule check
      const currentKo = this.currentStep.koPoint;
      if (currentKo && currentKo.x === x && currentKo.y === y) {
        return { legal: false, reason: '单劫禁止立即回提。' };
      }

      const colour = curState.toMove === 'B' ? BLACK : WHITE;
      const opponent = colour === BLACK ? WHITE : BLACK;

      // Simulate placement
      const sim = cloneState(curState);
      sim.cells[idx] = colour;

      // Check opponent captures
      const captures = [];
      const checked = new Set();
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (!inside(this.boardSize, nx, ny) || sim.cells[index(this.boardSize, nx, ny)] !== opponent) continue;
        const key = `${nx},${ny}`;
        if (checked.has(key)) continue;
        const grp = group(this.boardSize, sim, nx, ny);
        grp.points.forEach(([px, py]) => checked.add(`${px},${py}`));
        if (!grp.liberties.size) captures.push(...grp.points);
      }

      // Remove captured opponent stones
      for (const [cx, cy] of captures) {
        sim.cells[index(this.boardSize, cx, cy)] = 0;
      }

      // Check own liberties (suicide rule)
      const own = group(this.boardSize, sim, x, y);
      if (!own.liberties.size) {
        return { legal: false, reason: '禁止自杀着（无气）。' };
      }

      // Determine if this move creates a new single ko
      let nextKoPoint = null;
      if (captures.length === 1 && own.points.length === 1 && own.liberties.size === 1) {
        const onlyLib = own.liberties.values().next().value;
        const [lx, ly] = onlyLib.split(',').map(Number);
        if (lx === captures[0][0] && ly === captures[0][1]) {
          nextKoPoint = { x: captures[0][0], y: captures[0][1] };
        }
      }

      return { legal: true, captures, nextKoPoint };
    }

    /**
     * Play a stone at (x, y). If cursor < steps.length - 1, discards future steps and replaces.
     * Returns { success: boolean, reason?: string, replaced?: boolean }
     */
    playMove(x, y) {
      const check = this.validateMove(x, y);
      if (!check.legal) {
        return { success: false, reason: check.reason };
      }

      const curState = this.currentState;
      const nextMoveNumber = curState.moveNumber + 1;
      const colour = curState.toMove === 'B' ? BLACK : WHITE;
      const nextColor = curState.toMove === 'B' ? 'W' : 'B';

      const nextState = cloneState(curState);
      const idx = index(this.boardSize, x, y);
      nextState.cells[idx] = colour;
      nextState.numbers[idx] = nextMoveNumber;

      // Remove captures
      for (const [cx, cy] of check.captures) {
        const ci = index(this.boardSize, cx, cy);
        nextState.cells[ci] = 0;
        nextState.numbers[ci] = 0;
      }
      nextState.captures[curState.toMove] += check.captures.length;
      nextState.lastMove = { colour: curState.toMove, x, y, pass: false };
      nextState.moveNumber = nextMoveNumber;
      nextState.toMove = nextColor;

      let replaced = false;
      if (this.cursor < this.steps.length - 1) {
        this.steps = this.steps.slice(0, this.cursor + 1);
        replaced = true;
      }

      const newStep = {
        move: { color: curState.toMove, x, y, pass: false },
        state: nextState,
        koPoint: check.nextKoPoint,
        isPass: false,
        desc: `试下第 ${this.cursor + 1} 手：${curState.toMove === 'B' ? '黑' : '白'} ${engine.coordinate ? engine.coordinate(this.boardSize, x, y) : `(${x},${y})`}`
      };

      this.steps.push(newStep);
      this.cursor++;
      this.pendingMobilePoint = null;
      this.lastNotice = replaced ? '已替换原有后续试下。' : '';

      return { success: true, replaced };
    }

    /**
     * Play a pass move.
     */
    playPass() {
      const curState = this.currentState;
      const nextMoveNumber = curState.moveNumber + 1;
      const nextColor = curState.toMove === 'B' ? 'W' : 'B';

      const nextState = cloneState(curState);
      nextState.lastMove = { colour: curState.toMove, pass: true };
      nextState.moveNumber = nextMoveNumber;
      nextState.toMove = nextColor;

      let replaced = false;
      if (this.cursor < this.steps.length - 1) {
        this.steps = this.steps.slice(0, this.cursor + 1);
        replaced = true;
      }

      // Pass lifts any existing ko prohibition
      const newStep = {
        move: { color: curState.toMove, pass: true },
        state: nextState,
        koPoint: null,
        isPass: true,
        desc: `试下第 ${this.cursor + 1} 手：${curState.toMove === 'B' ? '黑' : '白'} 停一手`
      };

      this.steps.push(newStep);
      this.cursor++;
      this.pendingMobilePoint = null;
      this.lastNotice = replaced ? '已替换原有后续试下。' : '';

      // Check if both sides passed consecutively
      const prevStep = this.steps[this.cursor - 1];
      const consecutivePass = prevStep && prevStep.isPass;

      return { success: true, replaced, consecutivePass };
    }

    undo() {
      if (!this.canUndo()) return false;
      this.cursor--;
      this.pendingMobilePoint = null;
      this.lastNotice = '';
      return true;
    }

    redo() {
      if (!this.canRedo()) return false;
      this.cursor++;
      this.pendingMobilePoint = null;
      this.lastNotice = '';
      return true;
    }

    reset() {
      this.steps = [this.steps[0]];
      this.cursor = 0;
      this.pendingMobilePoint = null;
      this.lastNotice = '';
    }

    /**
     * Returns list of stones on current board with coordinates and move numbers.
     */
    stones() {
      const state = this.currentState;
      const list = [];
      for (let y = 0; y < this.boardSize; y++) {
        for (let x = 0; x < this.boardSize; x++) {
          const val = state.cells[index(this.boardSize, x, y)];
          if (val === BLACK || val === WHITE) {
            list.push({
              x, y,
              colour: val === BLACK ? 'B' : 'W',
              number: state.numbers[index(this.boardSize, x, y)] || 0
            });
          }
        }
      }
      return list;
    }
  }

  const TrialEngine = {
    detectOriginKo,
    TrialSession,
    cloneState,
    inside,
    group,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TrialEngine;
  }
  if (typeof window !== 'undefined') {
    window.GoSgfTrialEngine = TrialEngine;
  }
  globalThis.GoSgfTrialEngine = TrialEngine;
})();
