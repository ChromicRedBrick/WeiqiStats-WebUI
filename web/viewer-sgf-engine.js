/* DOM-free SGF navigation and Go board state. Kept separate from parsing and UI. */
(function (root) {
  const COLUMNS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
  const BLACK = 1, WHITE = 2;

  function coordinate(size, x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= size || y >= size) return '';
    return COLUMNS[x] + String(size - y);
  }

  function starPoints(size) {
    if (size === 19) {
      const points = [];
      for (const y of [3, 9, 15]) for (const x of [3, 9, 15]) points.push({x, y});
      return points;
    }
    if (size === 13) return [{x:3,y:3},{x:9,y:3},{x:6,y:6},{x:3,y:9},{x:9,y:9}];
    if (size === 9) return [{x:2,y:2},{x:6,y:2},{x:4,y:4},{x:2,y:6},{x:6,y:6}];
    return [];
  }

  function cloneState(state) {
    return {
      cells: new Uint8Array(state.cells), numbers: new Int32Array(state.numbers),
      toMove: state.toMove, lastMove: state.lastMove ? { ...state.lastMove } : null,
      captures: { B: state.captures.B, W: state.captures.W },
      moveNumber: state.moveNumber, error: state.error, errorNode: state.errorNode,
    };
  }

  class Navigator {
    constructor(boardSize, tree, handicap) {
      if (!tree || !tree.nodes || !tree.nodes[tree.root]) throw new Error('棋谱树不完整。');
      this.size = boardSize;
      this.nodes = tree.nodes;
      this.rootId = tree.root;
      this.handicap = Number(handicap) || 0;
      this.cache = new Map();
      this.cacheLimit = 64;
      this.branchSelections = new Map();
    }

    selectBranch(parentId, childId) {
      if (this.nodes[parentId]?.children?.includes(childId)) {
        this.branchSelections.set(parentId, childId);
      }
    }

    hasSelectedBranch(parentId) {
      return this.branchSelections.has(parentId);
    }

    chosenChild(nodeId) {
      const node = this.nodes[nodeId];
      if (!node || !node.children || !node.children.length) return null;
      const chosen = this.branchSelections.get(nodeId);
      if (chosen && node.children.includes(chosen)) return chosen;
      return node.children[0];
    }

    clearBranchSelections() {
      this.branchSelections.clear();
    }

    emptyState() {
      return {
        cells: new Uint8Array(this.size * this.size), numbers: new Int32Array(this.size * this.size),
        toMove: this.handicap >= 2 ? 'W' : 'B', lastMove: null,
        captures: {B: 0, W: 0}, moveNumber: 0, error: null, errorNode: null,
      };
    }

    inside(x, y) { return x >= 0 && y >= 0 && x < this.size && y < this.size; }
    index(x, y) { return y * this.size + x; }
    colourAt(state, x, y) { return !this.inside(x, y) ? 0 : state.cells[this.index(x, y)]; }

    group(state, x, y) {
      const colour = this.colourAt(state, x, y);
      if (!colour) return {points: [], liberties: new Set()};
      const points = [], liberties = new Set(), seen = new Set([`${x},${y}`]), queue = [[x, y]];
      while (queue.length) {
        const [cx, cy] = queue.shift(); points.push([cx, cy]);
        for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]) {
          if (!this.inside(nx, ny)) continue;
          const value = this.colourAt(state, nx, ny), key = `${nx},${ny}`;
          if (!value) liberties.add(key);
          else if (value === colour && !seen.has(key)) { seen.add(key); queue.push([nx, ny]); }
        }
      }
      return {points, liberties};
    }

    applySetup(state, setup) {
      if (!setup) return;
      for (const [key, value] of [['black', BLACK], ['white', WHITE], ['empty', 0]]) {
        for (const point of setup[key] || []) {
          if (!this.inside(point.x, point.y)) throw new Error('设置棋子超出棋盘。');
          const index = this.index(point.x, point.y);
          state.cells[index] = value; state.numbers[index] = 0;
        }
      }
    }

    applyNode(state, node) {
      if (state.error) return state;
      try { this.applySetup(state, node.setup); }
      catch (error) { state.error = error.message; state.errorNode = node.id; return state; }
      if (node.player_to_move === 'B' || node.player_to_move === 'W') state.toMove = node.player_to_move;
      const move = node.move;
      if (!move) return state;
      if (node.position_error) { state.error = node.position_error; state.errorNode = node.id; return state; }
      const colour = move.color === 'B' ? BLACK : WHITE;
      if (move.pass) {
        state.lastMove = {colour: move.color, pass: true}; state.moveNumber = node.move_number || state.moveNumber + 1;
        state.toMove = move.color === 'B' ? 'W' : 'B'; return state;
      }
      if (!this.inside(move.x, move.y)) { state.error = '落点超出棋盘。'; state.errorNode = node.id; return state; }
      const index = this.index(move.x, move.y);
      if (state.cells[index]) { state.error = `落点 ${coordinate(this.size, move.x, move.y)} 已有棋子。`; state.errorNode = node.id; return state; }
      const before = cloneState(state);
      state.cells[index] = colour; state.numbers[index] = node.move_number || state.moveNumber + 1;
      const opponent = colour === BLACK ? WHITE : BLACK, checked = new Set(), captures = [];
      for (const [nx, ny] of [[move.x-1,move.y],[move.x+1,move.y],[move.x,move.y-1],[move.x,move.y+1]]) {
        if (!this.inside(nx, ny) || state.cells[this.index(nx, ny)] !== opponent) continue;
        const key = `${nx},${ny}`; if (checked.has(key)) continue;
        const group = this.group(state, nx, ny); group.points.forEach(([px, py]) => checked.add(`${px},${py}`));
        if (!group.liberties.size) captures.push(...group.points);
      }
      for (const [cx, cy] of captures) { const i = this.index(cx, cy); state.cells[i] = 0; state.numbers[i] = 0; }
      const own = this.group(state, move.x, move.y);
      if (!own.liberties.size) {
        state.cells = before.cells; state.numbers = before.numbers;
        state.error = `第${node.move_number}手导致己方无气（自提），停止在可浏览前缀。`; state.errorNode = node.id;
        return state;
      }
      state.captures[move.color] += captures.length;
      state.lastMove = {colour: move.color, x: move.x, y: move.y, pass: false};
      state.moveNumber = node.move_number || state.moveNumber + 1;
      state.toMove = move.color === 'B' ? 'W' : 'B';
      return state;
    }

    pathTo(nodeId) {
      const path = []; let node = this.nodes[nodeId], guard = 0;
      while (node) {
        path.push(node.id); node = node.parent ? this.nodes[node.parent] : null;
        if (++guard > 100000) throw new Error('棋谱父节点关系异常。');
      }
      path.reverse(); return path;
    }

    cachedAncestor(path) {
      for (let index = path.length - 1; index >= 0; index--) {
        if (this.cache.has(path[index])) return index;
      }
      return -1;
    }

    cacheState(id, state) {
      this.cache.delete(id); this.cache.set(id, cloneState(state));
      while (this.cache.size > this.cacheLimit) this.cache.delete(this.cache.keys().next().value);
    }

    stateAt(nodeId) {
      if (!this.nodes[nodeId]) throw new Error('未找到棋谱节点。');
      const path = this.pathTo(nodeId);
      const cachedIndex = this.cachedAncestor(path);
      let state = cachedIndex >= 0 ? cloneState(this.cache.get(path[cachedIndex])) : this.emptyState();
      for (let index = cachedIndex + 1; index < path.length; index++) {
        state = this.applyNode(state, this.nodes[path[index]]);
        if (state.error) break;
      }
      this.cacheState(nodeId, state);
      return state;
    }

    mainlineMoves(tree) {
      const ordered = [];
      let cursor = this.rootId;
      while (cursor) {
        const node = this.nodes[cursor];
        if (node.move) ordered.push(node.id);
        const children = node.children || []; cursor = children[0] || null;
      }
      return ordered;
    }

    mainlineOpeningNode() {
      let cursor = this.nodes[this.rootId];
      let candidate = this.rootId;
      while (cursor) {
        if (cursor.move) break;
        candidate = cursor.id;
        cursor = cursor.children && cursor.children[0] ? this.nodes[cursor.children[0]] : null;
      }
      return candidate;
    }

    currentPathBounds(nodeId) {
      const ancestors = this.pathTo(nodeId);
      let openingNodeId = this.rootId;
      for (const id of ancestors) {
        if (this.nodes[id].move) break;
        openingNodeId = id;
      }
      let cursor = this.nodes[nodeId];
      let lastNodeId = nodeId;
      let maxMove = 0;
      for (const id of ancestors) {
        if (this.nodes[id].move && this.nodes[id].move_number > maxMove) {
          maxMove = this.nodes[id].move_number;
        }
      }
      let guard = 0;
      while (cursor && guard++ < 100000) {
        const nextId = this.chosenChild(cursor.id);
        if (!nextId) break;
        const nextNode = this.nodes[nextId];
        if (!nextNode || nextNode.position_error || nextNode.blocked) break;
        cursor = nextNode;
        lastNodeId = cursor.id;
        if (cursor.move && cursor.move_number > maxMove) {
          maxMove = cursor.move_number;
        }
      }
      return {
        openingNodeId,
        lastNodeId,
        maxMove,
        isMainline: !!this.nodes[nodeId]?.mainline,
      };
    }

    nodeForMove(nodeId, moveNumber) {
      if (moveNumber <= 0) {
        return this.currentPathBounds(nodeId).openingNodeId;
      }
      const path = this.pathTo(nodeId);
      for (const id of path) {
        const node = this.nodes[id];
        if (node.move && node.move_number === moveNumber) return id;
        if (node.move && node.move_number > moveNumber) return id;
      }
      let cursor = this.nodes[path[path.length - 1]];
      let lastValid = cursor.id;
      let guard = 0;
      while (cursor && guard++ < 100000) {
        const nextId = this.chosenChild(cursor.id);
        if (!nextId) break;
        const nextNode = this.nodes[nextId];
        if (!nextNode || nextNode.position_error || nextNode.blocked) break;
        cursor = nextNode;
        if (cursor.move) lastValid = cursor.id;
        if (cursor.move && cursor.move_number >= moveNumber) return cursor.id;
      }
      return lastValid || nodeId;
    }

    mainlineNodeForMove(moveNumber) {
      if (moveNumber <= 0) {
        return this.mainlineOpeningNode();
      }
      let cursor = this.nodes[this.rootId];
      let last = this.rootId;
      while (cursor) {
        if (cursor.move) last = cursor.id;
        if (cursor.move && cursor.move_number >= moveNumber) return cursor.id;
        cursor = cursor.children && cursor.children[0] ? this.nodes[cursor.children[0]] : null;
      }
      return last;
    }

    next(nodeId) {
      return this.chosenChild(nodeId);
    }

    previous(nodeId) { return this.nodes[nodeId]?.parent || null; }

    branchChoices(nodeId) {
      const chosen = this.chosenChild(nodeId);
      return (this.nodes[nodeId]?.children || []).map((id, index) => {
        const node = this.nodes[id], move = node.move;
        return {
          id,
          index,
          isChosen: id === chosen,
          label: move ? `${move.color === 'B' ? '黑' : '白'} ${move.pass ? '停一手' : coordinate(this.size, move.x, move.y)}${node.name ? ' · ' + node.name : ''}` : (node.name || `变化 ${index + 1}`),
          comment: node.comment || ''
        };
      });
    }

    nearestFork(nodeId) {
      const path = this.pathTo(nodeId);
      for (let i = path.length - 2; i >= 0; i--) {
        const id = path[i];
        const n = this.nodes[id];
        if (n && n.children && n.children.length > 1) {
          return id;
        }
      }
      return null;
    }

    branchOriginInfo(nodeId) {
      const path = this.pathTo(nodeId);
      const isMainline = !!this.nodes[nodeId]?.mainline;
      if (isMainline) {
        return { isMainline: true, forkNodeId: null, branchedAtMove: 0, branchLabel: '实战主线', currentBranchName: '' };
      }
      let forkId = null;
      let branchChildId = null;
      for (let i = path.length - 1; i >= 0; i--) {
        const id = path[i];
        const n = this.nodes[id];
        if (n.parent) {
          const parent = this.nodes[n.parent];
          if (parent && parent.children && parent.children.length > 1) {
            forkId = parent.id;
            branchChildId = id;
            break;
          }
        }
      }
      if (!forkId) {
        return { isMainline: false, forkNodeId: null, branchedAtMove: 0, branchLabel: '变化分支', currentBranchName: '' };
      }
      const forkNode = this.nodes[forkId];
      const branchChild = this.nodes[branchChildId];
      const branchedAtMove = forkNode.move ? forkNode.move_number : 0;
      let branchLabel = '';
      if (branchChild?.move) {
        const m = branchChild.move;
        branchLabel = `${m.color === 'B' ? '黑' : '白'} ${m.pass ? '停一手' : coordinate(this.size, m.x, m.y)}`;
      } else {
        branchLabel = branchChild?.name || '变化';
      }
      return {
        isMainline: false,
        forkNodeId: forkId,
        branchChildId,
        branchedAtMove,
        branchLabel,
        currentBranchName: branchChild?.name || ''
      };
    }

    candidateMoves(nodeId) {
      const node = this.nodes[nodeId];
      const children = node?.children || [];
      if (children.length <= 1) return [];
      const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const chosenId = this.chosenChild(nodeId);
      return children.map((childId, index) => {
        const childNode = this.nodes[childId];
        const move = childNode?.move;
        const letter = index < LETTERS.length ? LETTERS[index] : String(index + 1);
        const hasCoord = move && !move.pass && this.inside(move.x, move.y);
        return {
          childId,
          index,
          letter,
          isMainline: !!childNode?.mainline || index === 0,
          isChosen: childId === chosenId,
          hasCoord: !!hasCoord,
          x: hasCoord ? move.x : -1,
          y: hasCoord ? move.y : -1,
          pass: !!move?.pass,
          color: move?.color || null,
          name: childNode?.name || '',
          comment: childNode?.comment || '',
          coord: hasCoord ? coordinate(this.size, move.x, move.y) : '',
          label: move ? `${move.color === 'B' ? '黑' : '白'} ${move.pass ? '停一手' : coordinate(this.size, move.x, move.y)}${childNode?.name ? ' · ' + childNode.name : ''}` : (childNode?.name || `变化 ${index + 1}`)
        };
      });
    }

    variationBreadcrumb(nodeId) {
      const path = this.pathTo(nodeId);
      const breadcrumbs = [];
      for (let i = 0; i < path.length; i++) {
        const id = path[i];
        const node = this.nodes[id];
        const isCurrent = id === nodeId;
        const isFork = (node.children || []).length > 1;
        const isBranchHead = node.parent && (this.nodes[node.parent]?.children || []).length > 1;
        if (id === this.rootId || isFork || isCurrent || isBranchHead) {
          breadcrumbs.push({
            id,
            moveNumber: node.move_number || 0,
            isCurrent,
            isFork,
            isBranchHead,
            childCount: (node.children || []).length,
            label: node.move ? `${node.move.color === 'B' ? '黑' : '白'} ${node.move.pass ? '停一手' : coordinate(this.size, node.move.x, node.move.y)}` : (node.name || (id === this.rootId ? '开局' : '设置')),
            name: node.name || '',
            comment: node.comment || ''
          });
        }
      }
      return breadcrumbs;
    }

    stones(state) {
      const result = [];
      for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
        const value = state.cells[this.index(x, y)];
        if (value) result.push({x, y, colour: value === BLACK ? 'B' : 'W', number: state.numbers[this.index(x, y)] || 0});
      }
      return result;
    }
  }

  root.GoSgfEngine = {Navigator, coordinate, starPoints, COLUMNS};
})(typeof window !== 'undefined' ? window : globalThis);
