/* Place nodes by confirmed feeder relationships; never infer a result or an edge. */
(function(root) {
  // Reorder a complete, documented two-to-one forest from its last known
  // stage backwards. Redraw events can use the same binary drawing without
  // pretending that the source's match numbers are fixed bracket positions.
  function orderBinaryStages(stages, edges) {
    if (stages.length < 2 || stages.some(stage => !stage.length)) return null;
    const stageOf = new Map(), feeders = new Map(), successor = new Map();
    for (let i = 0; i < stages.length; i++) {
      if (i && stages[i - 1].length !== stages[i].length * 2) return null;
      for (const node of stages[i]) {
        if (!node.id || stageOf.has(node.id)) return null;
        stageOf.set(node.id, i);
      }
    }
    for (const edge of edges) {
      if (!stageOf.has(edge.sourceId) || !stageOf.has(edge.targetId)) continue;
      if (edge.kind && !['winner', 'scheduled'].includes(edge.kind)) return null;
      if (stageOf.get(edge.targetId) !== stageOf.get(edge.sourceId) + 1) return null;
      if (successor.has(edge.sourceId) && successor.get(edge.sourceId) !== edge.targetId) return null;
      successor.set(edge.sourceId, edge.targetId);
      if (!feeders.has(edge.targetId)) feeders.set(edge.targetId, new Set());
      feeders.get(edge.targetId).add(edge.sourceId);
    }
    const ordered = stages.map(stage => stage.slice());
    for (let i = stages.length - 2; i >= 0; i--) {
      if (stages[i].some(node => !successor.has(node.id))) return null;
      const originalOrder = new Map(stages[i].map((node, index) => [node.id, index]));
      const byId = new Map(stages[i].map(node => [node.id, node]));
      const next = [];
      for (const target of ordered[i + 1]) {
        const sourceIds = feeders.get(target.id);
        if (sourceIds?.size !== 2) return null;
        const slots = [target.black_player?.id || target.black_player_id || target.participant_1?.id || target.participant_1_id,
          target.white_player?.id || target.white_player_id || target.participant_2?.id || target.participant_2_id];
        const rank = node => {
          const winner = node.winner?.id || node.winner_id;
          const slot = winner ? slots.indexOf(winner) : -1;
          return slot < 0 ? 2 : slot;
        };
        next.push(...[...sourceIds].map(id => byId.get(id)).sort((a, b) =>
          rank(a) - rank(b) || originalOrder.get(a.id) - originalOrder.get(b.id)));
      }
      ordered[i] = next;
    }
    return ordered;
  }

  // 头衔战常在本赛决赛之后追加 1 对 1 的挑战者决定战或挑战手合：这类单线接力
  // 不改变淘汰树的分叉，先排好前面的二叉树，再把尾部原样接上。
  function splitTitleTail(stages, edges) {
    let tailStart = stages.length;
    while (tailStart > 1) {
      const current = stages[tailStart - 1], prev = stages[tailStart - 2];
      if (current.length !== 1) break;
      const feeders = edges.filter(e => e.targetId === current[0].id);
      if (feeders.length !== 1 || !prev.some(node => node.id === feeders[0].sourceId)) break;
      tailStart -= 1;
    }
    return tailStart;
  }

  // 首轮轮空：R0 的胜者进入 R1，而 R1 的每场由两路 R0 胜者组成，或一路胜者加一名
  // 直接进入 R1 的棋手。通常按 R1 的对阵位置把 R0 排成 0..2n-1 号槽位，再取
  // R1..末轮的二叉树顺序。
  // 20 人本赛这类签表还有第三种情形：R1 只有 4 局，R2 的 8 局里另 4 局双方都轮空。
  // 只有届次资料给出的参赛人数与「首轮局数 + 2×第二轮局数」相符、或明确记录过
  // 轮空时才允许这种整场轮空（allowByeTargets），缺局不会被当成轮空；此时每场
  // R2 至多一路 R1 来源，用紧凑槽位（目标序号）而不是双槽位排布。
  function orderByeHead(stages, edges, options = {}) {
    if (stages.length < 3 || !stages[0].length) return null;
    const suffix = orderBinaryStages(stages.slice(1), edges);
    if (!suffix) return null;

    const r0Ids = new Set();
    for (const node of stages[0]) {
      if (!node.id || r0Ids.has(node.id)) return null;
      r0Ids.add(node.id);
    }
    const r1Ids = new Set(suffix[0].map(node => node.id));
    const successor = new Map();
    const feeders = new Map();
    for (const edge of edges) {
      if (!r0Ids.has(edge.sourceId) || !r1Ids.has(edge.targetId)) continue;
      if (edge.kind && !['winner', 'scheduled'].includes(edge.kind)) return null;
      if (successor.has(edge.sourceId) && successor.get(edge.sourceId) !== edge.targetId) return null;
      successor.set(edge.sourceId, edge.targetId);
      if (!feeders.has(edge.targetId)) feeders.set(edge.targetId, new Set());
      feeders.get(edge.targetId).add(edge.sourceId);
    }
    if (successor.size !== stages[0].length) return null;
    // 首轮轮空里第二轮每场都至少有一路来自首轮。若第二轮存在整场没有来源的对局，
    // 说明首段只是上游片段，不能当成淘汰树的根层；只有资料确认存在轮空时才例外。
    if (feeders.size !== suffix[0].length && !options.allowByeTargets) return null;
    let maxFeeders = 0;
    for (const set of feeders.values()) {
      if (set.size > 2) return null;
      maxFeeders = Math.max(maxFeeders, set.size);
    }
    // 有整场轮空且每场第二轮至多一路首轮来源时，才用紧凑槽位；24/48 人签表
    // 每场都有一路首轮来源，仍按旧的双槽位保留轮空那一行。
    const byeCompact = feeders.size < suffix[0].length && maxFeeders < 2;

    const originalOrder = new Map(stages[0].map((node, index) => [node.id, index]));
    const r0ById = new Map(stages[0].map(node => [node.id, node]));
    const orderedR0 = [];
    const r0Slots = new Map();

    for (let targetIndex = 0; targetIndex < suffix[0].length; targetIndex++) {
      const target = suffix[0][targetIndex];
      const sourceIds = feeders.get(target.id);
      if (!sourceIds || !sourceIds.size) continue;
      const slots = [
        target.black_player?.id || target.black_player_id || target.participant_1?.id || target.participant_1_id,
        target.white_player?.id || target.white_player_id || target.participant_2?.id || target.participant_2_id,
      ];
      const rank = node => {
        const winner = node.winner?.id || node.winner_id;
        const slot = winner ? slots.indexOf(winner) : -1;
        return slot < 0 ? 2 : slot;
      };
      const group = [...sourceIds].map(id => r0ById.get(id)).sort((a, b) =>
        rank(a) - rank(b) || originalOrder.get(a.id) - originalOrder.get(b.id));
      orderedR0.push(...group);
      if (group.length === 2) {
        r0Slots.set(group[0].id, targetIndex * 2);
        r0Slots.set(group[1].id, targetIndex * 2 + 1);
      } else {
        const slotRank = rank(group[0]);
        r0Slots.set(group[0].id, byeCompact ? targetIndex : targetIndex * 2 + (slotRank === 1 ? 1 : 0));
      }
    }

    if (orderedR0.length !== stages[0].length) return null;
    return {stages: [orderedR0, ...suffix], hasByeFirstRound: true, r0Slots, byeCompact};
  }

  // Order a confirmed single-elimination knockout bracket. Full 2-to-1 trees
  // use orderBinaryStages directly; brackets whose only non-2-to-1 step is a
  // bye-populated opening round still order R1..Final as a binary tree and
  // place R0 matches by their target order and target player slots. A 1-to-1
  // title tail (挑战者决定战 → 挑战手合) may follow either shape.
  function orderKnockoutStages(stages, edges, options = {}) {
    const full = orderBinaryStages(stages, edges);
    if (full) return {stages: full, hasByeFirstRound: false, r0Slots: null, byeCompact: false};
    const tailStart = splitTitleTail(stages, edges);
    const hasTail = tailStart < stages.length;
    const head = hasTail ? stages.slice(0, tailStart) : stages;
    const tail = hasTail ? stages.slice(tailStart).map(stage => stage.slice()) : [];
    if (hasTail) {
      const headTree = orderBinaryStages(head, edges);
      if (headTree) return {stages: [...headTree, ...tail], hasByeFirstRound: false, r0Slots: null, byeCompact: false};
    }
    const byeHead = orderByeHead(head, edges, options);
    if (byeHead) return {stages: [...byeHead.stages, ...tail], hasByeFirstRound: true,
      r0Slots: byeHead.r0Slots, byeCompact: byeHead.byeCompact};
    return null;
  }

  // 轮空槽位只占用实际对局的位置；尾部 1 对 1 接力沿前驱轴线延长，不新增分叉。
  function arrangeBinaryWithByes(stages, r0Slots, gap = 28, axis = 'vertical') {
    const sizeKey = axis === 'horizontal' ? 'width' : 'height';
    const posKey = axis === 'horizontal' ? 'left' : 'top';
    const extent = n => n[sizeKey] ?? n.height ?? n.width ?? 0;
    const baseSizes = [...stages[0], ...(stages[1] || [])].map(extent);
    const slotExtent = baseSizes.length ? Math.max(...baseSizes) : 0;
    const pitch = slotExtent + gap;
    const placements = [];

    placements.push(stages[0].map(node => {
      const slot = r0Slots.get(node.id) ?? 0;
      const e = extent(node);
      const pos = slot * pitch + (slotExtent - e) / 2;
      return {...node, [posKey]: pos, center: pos + e / 2};
    }));

    if (stages.length > 1) placements.push(stages[1].map((node, j) => {
      const e = extent(node);
      const center = (2 * j + 0.5) * pitch + slotExtent / 2;
      return {...node, [posKey]: center - e / 2, center};
    }));

    for (let i = 2; i < stages.length; i++) {
      const prev = placements[i - 1];
      placements.push(stages[i].map((node, j) => {
        const e = extent(node);
        // 1 对 1 接力沿用前驱轴线；2 进 1 位于两路中间。
        const center = stages[i].length === prev.length ? prev[j].center
          : prev[2 * j + 1] ? (prev[2 * j].center + prev[2 * j + 1].center) / 2
          : prev[2 * j] ? prev[2 * j].center : (2 * j + 0.5) * pitch + slotExtent / 2;
        return {...node, [posKey]: center - e / 2, center};
      }));
    }

    const all = placements.flat();
    const minPos = Math.min(0, ...all.map(p => p[posKey]));
    if (minPos < 0) {
      for (const p of all) { p[posKey] -= minPos; p.center -= minPos; }
    }
    const total = Math.ceil(Math.max(0, ...all.map(p => p[posKey] + extent(p))));
    return axis === 'horizontal' ? {stages: placements, width: total} : {stages: placements, height: total};
  }

  // 首轮每场只送一名棋手进入第二轮、且第二轮有些对局双方都轮空时（20 人本赛），
  // 轮空位不占独立槽位：把首轮对局与它晋级的第二轮对局放在同一条轴线上，
  // 连线是一条直短线，整个签表仍保持第二轮 8 局的紧凑高度。
  function arrangeByeHeadCompact(stages, r0Slots, gap = 28, axis = 'vertical') {
    const sizeKey = axis === 'horizontal' ? 'width' : 'height';
    const posKey = axis === 'horizontal' ? 'left' : 'top';
    const extent = n => n[sizeKey] ?? n.height ?? n.width ?? 0;
    const base = stages[1] || [];
    const slotExtent = Math.max(0, ...stages[0].map(extent), ...base.map(extent));
    const pitch = slotExtent + gap;
    const placements = [];

    placements.push(stages[0].map(node => {
      const e = extent(node);
      const pos = (r0Slots.get(node.id) ?? 0) * pitch + (slotExtent - e) / 2;
      return {...node, [posKey]: pos, center: pos + e / 2};
    }));

    placements.push(base.map((node, j) => {
      const e = extent(node);
      const pos = j * pitch + (slotExtent - e) / 2;
      return {...node, [posKey]: pos, center: pos + e / 2};
    }));

    for (let i = 2; i < stages.length; i++) {
      const prev = placements[i - 1];
      placements.push(stages[i].map((node, j) => {
        const e = extent(node);
        // 1 对 1 接力沿用前驱轴线；2 进 1 位于两路中间。
        const center = stages[i].length === prev.length ? prev[j].center
          : prev[2 * j + 1] ? (prev[2 * j].center + prev[2 * j + 1].center) / 2
          : prev[2 * j] ? prev[2 * j].center : (2 * j + 0.5) * pitch + slotExtent / 2;
        return {...node, [posKey]: center - e / 2, center};
      }));
    }

    const all = placements.flat();
    const minPos = Math.min(0, ...all.map(p => p[posKey]));
    if (minPos < 0) {
      for (const p of all) { p[posKey] -= minPos; p.center -= minPos; }
    }
    const total = Math.ceil(Math.max(0, ...all.map(p => p[posKey] + extent(p))));
    return axis === 'horizontal' ? {stages: placements, width: total} : {stages: placements, height: total};
  }

  // `bandOf` keeps independent groups of one stage inside separate bands; the
  // order inside a band still follows the recorded feeders.
  function arrangeAxis(stages, edges, gap = 28, preserveOrder = false, axis = 'vertical', bandOf = null) {
    const sizeKey = axis === 'horizontal' ? 'width' : 'height';
    const posKey = axis === 'horizontal' ? 'left' : 'top';
    const band = node => (bandOf ? bandOf.get(node.id) ?? Number.MAX_SAFE_INTEGER : 0);
    const placements = [], known = new Map();
    stages.forEach((nodes, stageIndex) => {
      let fallback = 0;
      const planned = nodes.map((node, order) => {
        const extent = node[sizeKey] ?? node.height ?? node.width ?? 0;
        const feeders = edges.filter(e => e.targetId === node.id).map(e => known.get(e.sourceId)).filter(Boolean);
        const center = stageIndex && feeders.length ? feeders.reduce((sum, p) => sum + p.center, 0) / feeders.length : fallback + extent / 2;
        fallback += extent + gap;
        return {...node, _extent: extent, order, ideal: center};
      }).sort((a, b) => preserveOrder ? a.order - b.order : band(a) - band(b) || a.ideal - b.ideal || a.order - b.order);
      let end = -Infinity;
      const placed = planned.map(node => {
        const pos = preserveOrder
          ? (end === -Infinity ? 0 : end + gap)
          : Math.max(node.ideal - node._extent / 2, end + gap);
        end = pos + node._extent;
        return {...node, [posKey]: pos, center: pos + node._extent / 2};
      });
      const correction = placed.length ? placed.reduce((sum, p) => sum + p.ideal - p.center, 0) / placed.length : 0;
      for (const p of placed) { p[posKey] += correction; p.center += correction; known.set(p.id, p); }
      placements.push(placed);
    });
    const all = placements.flat();
    const shift = Math.max(0, -Math.min(0, ...all.map(p => p[posKey])));
    for (const p of all) { p[posKey] += shift; p.center += shift; }
    const total = Math.ceil(Math.max(0, ...all.map(p => p[posKey] + p._extent)));
    return axis === 'horizontal' ? {stages: placements, width: total} : {stages: placements, height: total};
  }
  function arrange(stages, edges, gap = 28, preserveOrder = false) {
    return arrangeAxis(stages, edges, gap, preserveOrder, 'vertical');
  }
  // Parallel groups are drawn as one ladder each: within a stage every group
  // keeps its own band and its winner/loser/final order, and each game is then
  // placed beside the feeders it is recorded against.
  function arrangeGroupBlocks(stages, lanes, edges, gap, axis, blocks) {
    const bandOf = new Map();
    blocks.forEach(map => { for (const [id, band] of Object.entries(map || {})) bandOf.set(id, band); });
    const laneRank = (id, index) => {
      const lane = lanes[index] && lanes[index][id];
      return lane === 'winner' ? 0 : lane === 'loser' ? 1 : 2;
    };
    const ordered = stages.map((nodes, index) => nodes
      .map((node, order) => ({node, order}))
      .sort((a, b) => (bandOf.get(a.node.id) ?? Number.MAX_SAFE_INTEGER) - (bandOf.get(b.node.id) ?? Number.MAX_SAFE_INTEGER)
        || laneRank(a.node.id, index) - laneRank(b.node.id, index) || a.order - b.order)
      .map(item => item.node));
    return arrangeAxis(ordered, edges, gap, false, axis, bandOf);
  }
  // Keep the winner and loser brackets in separate lanes while placing each
  // game near its recorded feeders. This only changes presentation order.
  // When the draw is a set of parallel groups (`blocks`), each group keeps its
  // own band: the games are ordered by group and lane, then placed beside the
  // feeders they are recorded against, so a group reads as one small ladder.
  function arrangeDoubleElimination(stages, lanes, edges, gap = 28, axis = 'vertical', blocks = null) {
    if (blocks) return arrangeGroupBlocks(stages, lanes, edges, gap, axis, blocks);
    const sizeKey = axis === 'horizontal' ? 'width' : 'height';
    const posKey = axis === 'horizontal' ? 'left' : 'top';
    const extent = n => n[sizeKey] || 0;
    const laneOf = (node, i) => typeof lanes[i] === 'string' ? lanes[i] : lanes[i][node.id] || 'final';
    const winnerStages = stages.map((nodes, i) => nodes.filter(n => laneOf(n, i) === 'winner'));
    const laneSize = Math.max(0, ...winnerStages.map(nodes => nodes.reduce((s, n) => s + extent(n), 0) + Math.max(0, nodes.length - 1) * gap));
    const loserStart = laneSize + gap * 2;
    const known = new Map(), placements = [];
    stages.forEach((nodes, i) => {
      const stagePlaced = [];
      for (const lane of ['winner', 'loser', 'final']) {
      const ordered = nodes.filter(n => laneOf(n, i) === lane);
      if (lane === 'winner' && !ordered.some(n => edges.some(e => e.targetId === n.id && known.has(e.sourceId)))) {
        const next = stages.slice(i + 1).map((stage, j) => stage.filter(n => laneOf(n, i + j + 1) === 'winner')).find(stage => stage.length) || [];
        ordered.sort((a, b) => {
          const rank = n => { const edge = edges.find(e => e.sourceId === n.id && e.kind === 'winner' && next.some(t => t.id === e.targetId));
            const index = next.findIndex(t => t.id === edge?.targetId); return index < 0 ? next.length : index; };
          return rank(a) - rank(b);
        });
      }
      const base = lane === 'loser' ? loserStart : 0;
      const planned = ordered.map((node, order) => {
        const feeders = edges.filter(e => e.targetId === node.id && known.has(e.sourceId))
          .filter(e => lane === 'final' || (lane === 'winner' ? e.kind !== 'loser' : known.get(e.sourceId).lane === 'loser'))
          .map(e => known.get(e.sourceId));
        const ideal = feeders.length ? feeders.reduce((s, p) => s + p.center, 0) / feeders.length : base + order * (extent(node) + gap) + extent(node) / 2;
        return {...node, lane, order, ideal};
      }).sort((a, b) => a.ideal - b.ideal || a.order - b.order);
      let end = base - gap;
      const placed = planned.map(node => {
        const pos = Math.max(base, node.ideal - extent(node) / 2, end + gap);
        end = pos + extent(node);
        const result = {...node, [posKey]: pos, center: pos + extent(node) / 2};
        known.set(node.id, result); return result;
      });
      stagePlaced.push(...placed);
      }
      placements.push(stagePlaced);
    });
    const total = Math.ceil(Math.max(0, ...placements.flat().map(n => n[posKey] + extent(n))));
    return axis === 'horizontal' ? {stages: placements, width: total} : {stages: placements, height: total};
  }
  // Scale the existing wiki bracket's centres uniformly. This preserves fork
  // midpoints (including compact first-round blocks) while making room for a
  // taller expanded series. Captions/controls reserve space below its anchor.
  function centerWikiStagesAxis(stages, gap = 30, padding = 8, axis = 'vertical') {
    const sizeKey = axis === 'horizontal' ? 'width' : 'height';
    const posKey = axis === 'horizontal' ? 'left' : 'top';
    let scale = 1;
    for (const stage of stages) {
      const nodes = stage.slice().sort((a, b) => a.baseCenter - b.baseCenter);
      for (let i = 1; i < nodes.length; i++) {
        const prev = nodes[i - 1], next = nodes[i], distance = next.baseCenter - prev.baseCenter;
        if (distance > 0) scale = Math.max(scale, (prev[sizeKey] - prev.anchorOffset + gap + next.anchorOffset) / distance);
      }
    }
    const minimum = Math.min(padding, ...stages.flat().map(n => n.baseCenter * scale - n.anchorOffset));
    const shift = padding - minimum;
    const placements = stages.map(stage => stage.map(n => ({...n, center: n.baseCenter * scale + shift,
      [posKey]: n.baseCenter * scale + shift - n.anchorOffset})));
    const total = Math.ceil(Math.max(0, ...placements.flat().map(n => n[posKey] + n[sizeKey])) + padding);
    return axis === 'horizontal' ? {stages: placements, width: total} : {stages: placements, height: total};
  }
  function centerWikiStages(stages, gap = 30, padding = 8) {
    return centerWikiStagesAxis(stages, gap, padding, 'vertical');
  }
  function centerWikiStagesHorizontal(stages, gap = 24, padding = 8) {
    return centerWikiStagesAxis(stages, gap, padding, 'horizontal');
  }
  if (typeof module !== 'undefined' && module.exports) module.exports={arrange, arrangeAxis, arrangeBinaryWithByes, arrangeByeHeadCompact, arrangeDoubleElimination, centerWikiStages, centerWikiStagesHorizontal, orderBinaryStages, orderKnockoutStages};
  else root.GoViewerLayout={arrange, arrangeAxis, arrangeBinaryWithByes, arrangeByeHeadCompact, arrangeDoubleElimination, centerWikiStages, centerWikiStagesHorizontal, orderBinaryStages, orderKnockoutStages};
})(typeof window==='undefined' ? globalThis : window);
