/* Individual round-robin views. All grouping and statistics are display copies;
 * absent pairings, official standings and tiebreak rules are never inferred. */
(function (root) {
  'use strict';
  const M = typeof module !== 'undefined' && module.exports ? require('./viewer-model.js') : root.GoViewerModel;
  const esc = M.escape, states = new Map();
  const clean = name => String(name || '').normalize('NFKC').trim().replace(/\s+/g, '').replace(/\|/g, '｜');
  const STAGE_PREFIX = /^循环赛[｜|]/;
  const GROUP_NAME = /^(?:\d+强)?[A-H]组(?:\d+[场局轮])?$/;
  const NOT_LEAGUE = /→|->|积分编排|瑞士|スイス|加赛|加賽|プレーオフ|勝者|胜者|败者|敗者|決定戦|决定战|决定赛|決定賽|(?:32|16|8|4)强|番棋第\d+局/;
  function isLeagueRound(round) {
    const name = clean(round.round_name);
    const core = name.replace(STAGE_PREFIX, '');
    // 16强A组这类分组赛按表格呈现；它不会进入淘汰连线。
    if (GROUP_NAME.test(core)) return true;
    if (NOT_LEAGUE.test(core)) return false;
    if (/循环|循環|リーグ/.test(core)) return true;
    // 「循环赛｜」只是赛段前缀：其后若是循环圈轮次仍归表格，淘汰阶段已由上面的排除项拦下。
    return STAGE_PREFIX.test(name);
  }
  function groupLabel(round) {
    return clean(round.round_name)
      .replace(STAGE_PREFIX, '')
      .replace(/第[\d一二三四五六七八九十百]+(?:\/\d+)?[轮輪局]/g, '')
      .replace(/最终[轮輪]|最終[轮輪]/g, '')
      .replace(/([A-H]组)\d+[场局]$/, '$1')
      .replace(/[｜|]+$/, '') || '循环圈';
  }
  function outcome(game, player) {
    const pair = M.participants(game), winner = game.winner?.id || game.winner_id;
    if (M.isNoResult(game) || game.match_status === 'no_result') return {kind: 'no-result', label: '无胜负'};
    if (game.result_method === 'draw' || /^(和棋|持碁|平局)$/.test(game.result_type || game.result_detail || '')) return {kind: 'draw', label: '和棋'};
    if (game.match_status === 'bye' || game.result_method === 'bye' || game.result_type === '轮空') return {kind: 'bye', label: '轮空'};
    if (winner && pair.some(p => p.id === winner) && pair.filter(p => p.id).length === 2) {
      return {kind: winner === player.id ? 'win' : 'loss', label: winner === player.id ? '胜' : '负'};
    }
    return game.match_status === 'scheduled' ? {kind: 'scheduled', label: '待赛'} : {kind: 'pending', label: '赛果待补'};
  }
  function buildGroup(group, data, qualifiers) {
    const players = new Map(), pairs = new Map(), columns = new Map();
    const orderedRounds = [...new Set(group.entries.map(e => e.round))];
    const hasRounds = orderedRounds.some(r => /第[\d一二三四五六七八九十百]+(?:\/\d+)?[轮輪]|最终[轮輪]|最終[轮輪]/.test(clean(r.round_name)));
    const byDate = !hasRounds && group.entries.some(e => e.game.date);
    group.kind = GROUP_NAME.test(group.label) ? 'group' : 'league';
    // 棋圣 C 级循环圈是 32 人、5 回战积分循环（5 连胜优胜、3 败淘汰），
    // 不是 32 人单循环；交叉表只作为实际对局记录使用，默认改看按轮次。
    group.formatNote = (data?.tournament?.id === 'jp_kisei' && /^C循环圈/.test(group.label))
      ? '32人 · 5轮积分循环（5连胜优胜，3败淘汰）'
      : '';
    group.entries.sort((a, b) => (M.dateKey(a.game.date) || '9999').localeCompare(M.dateKey(b.game.date) || '9999')
      || Number(a.round.round_order || 0) - Number(b.round.round_order || 0)
      || Number(a.game.match_number || 0) - Number(b.game.match_number || 0));
    for (const entry of group.entries) {
      const {game, round} = entry, pair = M.participants(game);
      entry.column = byDate ? (M.dateKey(game.date)?.slice(0, 7) || game.date || 'undated') : clean(round.round_name);
      if (!columns.has(entry.column)) columns.set(entry.column, {id: entry.column,
        label: byDate ? entry.column === 'undated' ? '日期未知' : entry.column : (clean(round.round_name).match(/第[\d一二三四五六七八九十百]+(?:\/\d+)?[轮輪]|最终[轮輪]|最終[轮輪]/)?.[0] || M.roundDisplayName(round)),
        order: Number(clean(round.round_name).match(/第(\d+)(?:\/\d+)?[轮輪]/)?.[1] || round.round_order || orderedRounds.indexOf(round)), entries: []});
      columns.get(entry.column).entries.push(entry);
      for (const p of pair.filter((p, i) => p.id && pair.findIndex(q => q.id === p.id) === i)) {
        if (!players.has(p.id)) players.set(p.id, {player: p, win: 0, loss: 0, draw: 0, 'no-result': 0, scheduled: 0, pending: 0, bye: 0});
        players.get(p.id)[outcome(game, p).kind]++;
      }
      if (pair[0].id && pair[1].id && pair[0].id !== pair[1].id) {
        const key = [pair[0].id, pair[1].id].sort().join('\0');
        if (!pairs.has(key)) pairs.set(key, []);
        pairs.get(key).push(entry);
      }
    }
    // Display order: official league rank when recorded, otherwise recorded
    // wins/losses, head-to-head for a two-way tie, then name. Ranks are shown
    // as numbers but remain an "as recorded" standing, not an official table.
    const nameOf = p => String(p.player.name_zh || p.player.id);
    const byName = (a, b) => nameOf(a).localeCompare(nameOf(b), 'zh-CN')
      || String(a.player.id).localeCompare(String(b.player.id));
    const official = new Map();
    for (const row of (data && data.league_rankings) || []) {
      const rank = Number(row && row.rank);
      if (row && row.player_id && Number.isFinite(rank)) official.set(row.player_id, {rank, note: row.note || ''});
    }
    const headToHead = (a, b) => {
      const entries = pairs.get([a.player.id, b.player.id].sort().join('\0')) || [];
      let score = 0;
      for (const entry of entries) {
        const result = outcome(entry.game, a.player);
        if (result.kind === 'win') score++;
        else if (result.kind === 'loss') score--;
      }
      return score;
    };
    const tieSize = new Map();
    for (const p of players.values()) {
      const key = `${p.win}-${p.loss}`;
      tieSize.set(key, (tieSize.get(key) || 0) + 1);
    }
    const byRecord = (a, b) => {
      if (b.win !== a.win) return b.win - a.win;
      if (a.loss !== b.loss) return a.loss - b.loss;
      if (tieSize.get(`${a.win}-${a.loss}`) === 2) {
        const score = headToHead(b, a);
        if (score) return score > 0 ? 1 : -1;
      }
      return byName(a, b);
    };
    const isQualified = p => Boolean(qualifiers && qualifiers.has(p.player.id));
    const byStanding = (a, b) => {
      const ra = official.get(a.player.id), rb = official.get(b.player.id);
      if (ra && rb) return ra.rank - rb.rank || byName(a, b);
      if (ra) return -1;
      if (rb) return 1;
      if (isQualified(a) !== isQualified(b)) return isQualified(a) ? -1 : 1;
      return byRecord(a, b);
    };
    const standings = [...players.values()].sort(byStanding);
    let nextRank = 1;
    for (const p of standings) {
      const row = official.get(p.player.id);
      if (row) nextRank = Math.max(nextRank, row.rank + 1);
    }
    for (const p of standings) {
      const row = official.get(p.player.id);
      p.rank = row ? row.rank : nextRank++;
      p.rankNote = row ? row.note : '';
    }
    group.players = standings;
    group.hasOfficialRanks = official.size > 0;
    group.qualifiers = qualifiers || new Set();
    group.pairs = pairs;
    group.byDate = byDate;
    group.columns = [...columns.values()];
    if (hasRounds) group.columns.sort((a, b) => a.order - b.order);
    group.loose = group.entries.filter(e => {
      const ids = M.participants(e.game).map(p => p.id);
      return !ids[0] || !ids[1] || ids[0] === ids[1];
    });
    return group;
  }
  function partition(data, rounds = M.roundsForView(data).mainRounds) {
    const groups = new Map(), rest = [], leagueRounds = [];
    if (M.isTeamCompetition(data)) return {groups: [], rest: rounds, leagueRounds};
    for (const round of rounds) {
      // Source-verified two-group league (Korea Ki-in 1506), also documented
      // by viewer-model.js; its imported labels omit the word "循环".
      const inauguralFuture = data.edition?.id === 'kr_future_01' && /^本赛[AB]组第\d+局$/.test(clean(round.round_name));
      if (!isLeagueRound(round) && !inauguralFuture) {rest.push(round); continue;}
      leagueRounds.push(round);
      for (const game of round.matches || []) {
        const label = groupLabel(round) + (game.draw_group ? ` · ${clean(game.draw_group)}` : '');
        if (!groups.has(label)) groups.set(label, {id: label, label, entries: []});
        groups.get(label).entries.push({game, round});
      }
      if (!(round.matches || []).length) {
        const label = groupLabel(round);
        if (!groups.has(label)) groups.set(label, {id: label, label, entries: []});
      }
    }
    const grade = g => {const hit = /^([SABC])(?:循环|循環|リーグ)/.exec(g.label); return hit ? 'SABC'.indexOf(hit[1]) : 4;};
    // 分组出线名单只看下一阶段实际出现的棋手，不凭战绩推测晋级。
    const qualifiers = new Set();
    for (const match of rest[0]?.matches || []) {
      for (const p of M.participants(match)) if (p && p.id) qualifiers.add(p.id);
    }
    return {groups: [...groups.values()].sort((a, b) => grade(a) - grade(b))
      .map(group => {
        buildGroup(group, data, qualifiers);
        // 第六届最高棋士决定战的原始轮名沿用了“循环赛”。赛事公告确认
        // 16强是四人双败；仅在赛程关系完整吻合时展示推导出的阶段。
        if (data.edition?.id === 'kr_sawpal_06' && group.kind === 'group') {
          group.doubleElimination = doubleEliminationStages(group.entries);
        }
        return group;
      }), rest, leagueRounds};
  }
  function doubleEliminationStages(entries) {
    if (entries.length !== 5) return null;
    const ordered = [...entries].sort((a, b) => (M.dateKey(a.game.date) || '').localeCompare(M.dateKey(b.game.date) || ''));
    if (ordered.some(e => !M.dateKey(e.game.date))) return null;
    const ids = e => M.participants(e.game).map(p => p.id);
    const winner = e => e.game.winner?.id || e.game.winner_id;
    const loser = e => ids(e).find(id => id !== winner(e));
    const same = (e, pair) => ids(e).length === 2 && pair.every(id => id && ids(e).includes(id));
    const first = ordered.slice(0, 2);
    if (new Set(first.flatMap(ids)).size !== 4 || ordered.some(e => !ids(e).includes(winner(e)))) return null;
    const middle = ordered.slice(2, 4);
    const winners = middle.find(e => same(e, first.map(winner)));
    const losers = middle.find(e => same(e, first.map(loser)));
    const decider = ordered[4];
    if (!winners || !losers || winners === losers || !same(decider, [loser(winners), winner(losers)])) return null;
    return {first, winners, losers, decider};
  }
  function stateFor(data, scope) {
    const key = `${data.edition.id}:${scope}`;
    if (!states.has(key)) states.set(key, {
      view: data?.tournament?.id === 'jp_kisei' ? 'rounds' : 'cross',
      group: '', sort: 'record'});
    return states.get(key);
  }
  function revealMatch(data, id, scope = 'main') {
    const rounds = scope === 'prelim' ? (data.rounds || []).filter(M.isPrelimRound) : M.roundsForView(data).mainRounds;
    const group = partition(data, rounds).groups.find(g => g.entries.some(e => e.game.id === id));
    if (!group) return false;
    stateFor(data, scope).group = group.id;
    return true;
  }
  // 单个分组的展示副本：牌面、备注与表格集中生成，屏幕渲染与导出共用。
  function groupView(group, state) {
    const playerName = p => esc(p.name_zh || p.id);
    const playerButton = p => `<button class="league-player" type="button" data-league-player="${esc(p.id)}">${playerName(p)}</button>`;
    if (group.doubleElimination) {
      const stages = group.doubleElimination;
      const match = (entry, label) => {
        const game = entry.game, winner = game.winner?.id || game.winner_id;
        const players = M.participants(game).map(p => {
          const color = game.black_player_id === p.id ? 'black' : game.white_player_id === p.id ? 'white' : '';
          return `<span class="league-double-player${p.id === winner ? ' is-winner' : ''}">${color ? `<i class="stone-icon stone-${color}" aria-hidden="true"></i>` : ''}${playerButton(p)}${p.id === winner ? '<span class="league-double-win">胜</span>' : ''}</span>`;
        }).join('');
        return `<article class="league-double-match"><div class="league-double-match-heading"><strong>${label}</strong><button type="button" class="league-double-detail" data-match-id="${esc(game.id)}"><span>${esc(M.dateLabel(game.date))}</span><span class="league-double-detail-label"> · 详情</span></button></div>${players}</article>`;
      };
      const tableHtml = `<div class="league-table-scroll league-double-scroll" role="region" aria-label="小组双败赛程" tabindex="0"><div class="league-double-bracket"><section class="league-double-stage"><h4>首轮</h4>${stages.first.map((entry, i) => match(entry, `第${i + 1}场`)).join('')}</section><section class="league-double-stage"><h4>第二轮</h4>${match(stages.winners, '胜者战')}${match(stages.losers, '败者战')}</section><section class="league-double-stage"><h4>出线战</h4>${match(stages.decider, '出线争夺')}</section></div></div>`;
      return {kind: 'group', players: group.players, heading: '小组双败淘汰', meta: `${group.players.length} 名棋手 · ${group.entries.length} 局`,
        viewLabel: '双败赛程', sortNote: '', tableHtml, looseHtml: '', doubleElimination: true};
    }
    const kind = group.kind === 'group' ? 'group' : 'league';
    const rankBadge = r => `<span class="league-rank" title="${esc(kind === 'group' ? `战绩第${r.rank}位` : r.rankNote ? `第${r.rank}名（${r.rankNote}）` : `第${r.rank}名`)}">${r.rank}</span>`;
    const qualifiedBadge = r => kind === 'group' && group.qualifiers.has(r.player.id)
      ? '<span class="league-qualified">出线</span>' : '';
    const nameKey = r => String(r.player.name_zh || r.player.id);
    const players = state.sort === 'name'
      ? [...group.players].sort((a, b) => nameKey(a).localeCompare(nameKey(b), 'zh-CN')
        || String(a.player.id).localeCompare(String(b.player.id)))
      : group.players;
    const gameButton = (entry, p, withOpponent = false) => {
      const g = entry.game, result = outcome(g, p), opponent = M.participants(g).find(q => q.id !== p.id);
      const color = g.black_player_id === p.id ? 'black' : g.white_player_id === p.id ? 'white' : '';
      const colorLabel = color ? `执${color === 'black' ? '黑' : '白'}` : '执色未知';
      const label = `${p.name_zh || p.id} 对 ${opponent?.name_zh || '—'}：${result.label}，${colorLabel}，${M.dateLabel(g.date)}`;
      return `<button type="button" class="league-game league-${result.kind}${withOpponent ? ' league-round-game' : ''}" data-match-id="${esc(g.id)}" aria-label="${esc(label)}" title="${esc(label)}"><span class="league-result">${color ? `<i class="stone-icon stone-${color}" aria-hidden="true"></i>` : ''}<span>${result.label}</span></span>${withOpponent ? `<span class="league-opponent">${opponent?.id ? playerName(opponent) : '—'}</span>${group.byDate ? `<small class="league-game-date">${esc(M.dateKey(g.date)?.slice(5) || M.dateLabel(g.date))}</small>` : ''}` : ''}</button>`;
    };
    const summary = r => `${r.win}胜 ${r.loss}负${r.draw ? ` ${r.draw}和` : ''}`;
    const remaining = r => [r['no-result'] ? `${r['no-result']}无胜负` : '', r.scheduled ? `${r.scheduled}待赛` : '', r.pending ? `${r.pending}待补` : '', r.bye ? `${r.bye}轮空` : ''].filter(Boolean).join(' · ');
    const sortNote = state.sort === 'name'
      ? '棋手按姓名排列；数字为战绩名次。格内胜负以所在行棋手为准。'
      : kind === 'group'
        ? `棋手按${group.hasOfficialRanks ? '官方顺位' : '出线及战绩（胜→负→交手）'}排列，格内胜负以所在行棋手为准。`
        : `棋手按${group.hasOfficialRanks ? '官方顺位' : '战绩（胜→负→交手）'}排列，格内胜负以所在行棋手为准。`;
    const heading = kind === 'group' ? '小组赛战绩' : '循环圈战绩';
    const meta = kind === 'group'
      ? `${group.players.length} 名棋手 · ${group.entries.length} 局`
      : `${group.players.length}名循环圈棋手 共${group.entries.length}次对局`;
    const viewLabel = state.view === 'cross' ? '交叉战绩' : group.byDate ? '按月份' : '按轮次';
    const tableHtml = `<div class="league-table-scroll" role="region" aria-label="${state.view === 'cross' ? '交叉战绩表' : '轮次战绩表'}" tabindex="0"><table class="league-table"><caption class="sr-only">${esc(group.label)} · 战绩</caption><thead><tr><th scope="col" class="league-sticky">棋手</th><th scope="col">战绩</th>${state.view === 'cross'
        ? players.map(r => `<th scope="col" data-league-col="${esc(r.player.id)}">${playerName(r.player)}</th>`).join('')
        : group.columns.map(c => `<th scope="col">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${players.map(r => {
        const p = r.player;
        return `<tr data-league-row="${esc(p.id)}"><th scope="row" class="league-sticky">${rankBadge(r)}${playerButton(p)}${qualifiedBadge(r)}</th><td class="league-summary"><strong>${summary(r)}</strong>${remaining(r) ? `<small>${remaining(r)}</small>` : ''}</td>${state.view === 'cross' ? players.map(other => {
          const id = other.player.id;
          if (id === p.id) return `<td class="league-diagonal" data-league-col="${esc(id)}" aria-label="本人">／</td>`;
          const entries = group.pairs.get([p.id, id].sort().join('\0')) || [];
          return `<td data-league-col="${esc(id)}">${entries.length ? `<div class="league-cell-games">${entries.map(e => gameButton(e, p)).join('')}</div>` : '<span class="league-empty">—</span>'}</td>`;
        }).join('') : group.columns.map(c => {
          const entries = c.entries.filter(e => M.participants(e.game).some(q => q.id === p.id));
          return `<td>${entries.length ? `<div class="league-cell-games">${entries.map(e => gameButton(e, p, true)).join('')}</div>` : '<span class="league-empty">—</span>'}</td>`;
        }).join('')}</tr>`;
      }).join('')}</tbody></table></div>`;
    const looseHtml = group.loose.length ? `<section class="league-loose"><h3>其他对局</h3>${group.loose.map(e => `<button class="btn" type="button" data-match-id="${esc(e.game.id)}">${esc(M.dateLabel(e.game.date))} · ${M.participants(e.game).map(p => esc(p.name_zh || '—')).join(' / ')} · ${outcome(e.game, M.participants(e.game)[0]).label} · 详情</button>`).join('')}</section>` : '';
    return {kind, players, sortNote, heading, meta, viewLabel, tableHtml, looseHtml,
            formatNote: group.formatNote || ''};
  }

  function render(options) {
    const {data, groups, canvas, showMatch, showPlayer, onDraw, scope = 'main'} = options;
    canvas.querySelectorAll('.league-results').forEach(el => el.remove());
    if (!groups.length) return;
    const state = stateFor(data, scope);
    if (!groups.some(g => g.id === state.group)) state.group = groups[0].id;
    const group = groups.find(g => g.id === state.group), block = document.createElement('section');
    block.className = 'round-col league-results'; block.dataset.leagueView = state.view;
    const rerender = focus => {
      const scroll = block.querySelector('.league-table-scroll'), pos = {left: scroll.scrollLeft, top: scroll.scrollTop};
      render(options); onDraw();
      const next = canvas.querySelector('.league-results');
      if (focus === 'view') next.querySelector(`[data-league-view="${state.view}"]`).focus({preventScroll: true});
      if (focus === 'sort') next.querySelector(`[data-league-sort="${state.sort}"]`).focus({preventScroll: true});
      if (focus === 'group') next.querySelector('.league-group-select')?.focus({preventScroll: true});
      next.querySelector('.league-table-scroll').scrollTo(pos);
    };
    const view = groupView(group, state);
    block.innerHTML = `<header class="league-header"><div><h2>${view.heading}</h2><p class="league-meta">${view.meta}</p>${view.formatNote ? `<p class="league-format-note">${esc(view.formatNote)}</p>` : ''}</div>
      ${view.doubleElimination ? '' : `<nav class="league-controls" aria-label="${view.heading}呈现方式">${[['cross', '交叉战绩'], ['rounds', group.byDate ? '按月份' : '按轮次']].map(([mode, label]) => `<button type="button" class="btn" data-league-view="${mode}" aria-pressed="${state.view === mode}">${label}</button>`).join('')}<span class="league-control-sep" aria-hidden="true">·</span>${[['record', '按战绩'], ['name', '按姓名']].map(([sortMode, label]) => `<button type="button" class="btn" data-league-sort="${sortMode}" aria-pressed="${state.sort === sortMode}" aria-label="${label}排序">${label}</button>`).join('')}</nav>`}</header>
      ${groups.length > 1 ? `<label class="league-group-control league-controls">分组 / 赛段<select class="league-group-select" aria-label="选择${view.kind === 'group' ? '小组' : '循环圈分组'}">${groups.map(g => `<option value="${esc(g.id)}"${g.id === group.id ? ' selected' : ''}>${esc(g.label)}</option>`).join('')}</select></label>` : ''}
      <h3 class="league-group-title" aria-live="polite">${esc(group.label)} · ${view.viewLabel}</h3>
      ${view.sortNote ? `<p class="league-note">${view.sortNote}</p>` : ''}
      ${view.tableHtml}
      ${!group.players.length ? '<p class="league-note">暂无完整参赛棋手资料，可查看下方对局记录。</p>' : ''}
      ${view.looseHtml}`;
    const entries = new Map(group.entries.map(e => [e.game.id, e]));
    block.addEventListener('click', event => {
      const view = event.target.closest('button[data-league-view]');
      if (view) {state.view = view.dataset.leagueView; rerender('view'); return;}
      const sort = event.target.closest('button[data-league-sort]');
      if (sort) {state.sort = sort.dataset.leagueSort; rerender('sort'); return;}
      const player = event.target.closest('[data-league-player]');
      if (player) {showPlayer(player.dataset.leaguePlayer); return;}
      const game = event.target.closest('[data-match-id]');
      if (game) showMatch(entries.get(game.dataset.matchId).game);
    });
    block.querySelector('.league-group-select')?.addEventListener('change', event => {state.group = event.target.value; rerender('group');});
    const table = block.querySelector('.league-table');
    const highlight = cell => {
      table.querySelectorAll('.league-axis-active').forEach(el => el.classList.remove('league-axis-active'));
      const row = cell?.closest('[data-league-row]'), col = cell?.closest('[data-league-col]')?.dataset.leagueCol;
      if (row) row.classList.add('league-axis-active');
      if (col) table.querySelectorAll('[data-league-col]').forEach(el => {if (el.dataset.leagueCol === col) el.classList.add('league-axis-active');});
    };
    table?.addEventListener('pointerover', event => highlight(event.target));
    table?.addEventListener('pointerleave', () => highlight(null));
    table?.addEventListener('focusin', event => highlight(event.target));
    table?.addEventListener('focusout', event => {if (!table.contains(event.relatedTarget)) highlight(null);});
    canvas.insertBefore(block, canvas.querySelector('.league-knockout, .prelim-view'));
  }
  // 导出：把全部分组按顺序纵向排列到同一列，供导出快照克隆使用。
  function renderExport(options) {
    const {container, data, groups, scope = 'main'} = options;
    if (!container || !groups || !groups.length) return null;
    const state = stateFor(data, scope);
    const views = groups.map(group => ({group, view: groupView(group, state)}));
    const kind = views[0].view.kind;
    const heading = views.every(({view}) => view.doubleElimination) ? '小组双败淘汰' : kind === 'group' ? '小组赛战绩' : '循环圈战绩';
    const players = new Set(), games = new Set();
    groups.forEach(group => {
      group.players.forEach(row => players.add(row.player.id));
      group.entries.forEach(entry => games.add(entry.game.id));
    });
    const meta = kind === 'group'
      ? `${groups.length} 组 · ${players.size} 名棋手 · ${games.size} 局`
      : `${players.size}名循环圈棋手 共${games.size}次对局`;
    const official = groups.every(group => group.hasOfficialRanks);
    const note = views.every(({view}) => view.doubleElimination) ? views[0].view.sortNote : state.sort === 'name'
      ? '棋手按姓名排列；数字为战绩名次。格内胜负以所在行棋手为准。'
      : kind === 'group'
        ? `棋手按${official ? '官方顺位' : '出线及战绩（胜→负→交手）'}排列，格内胜负以所在行棋手为准。`
        : `棋手按${official ? '官方顺位' : '战绩（胜→负→交手）'}排列，格内胜负以所在行棋手为准。`;
    container.innerHTML = `<header class="league-header"><div><h2>${heading}</h2><p class="league-meta">${meta}</p></div></header>
      ${note ? `<p class="league-note">${note}</p>` : ''}${views.map(({group, view}) => `<section class="league-export-group">
        <h3 class="league-group-title">${esc(group.label)} · ${view.viewLabel}</h3>
        ${view.formatNote ? `<p class="league-format-note">${esc(view.formatNote)}</p>` : ''}
        ${view.tableHtml}
        ${!group.players.length ? '<p class="league-note">暂无完整参赛棋手资料。</p>' : ''}
        ${view.looseHtml}
      </section>`).join('')}`;
    return container;
  }
  const api = {partition, isLeagueRound, outcome, revealMatch, render, renderExport};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GoViewerLeague = api;
})(typeof window === 'undefined' ? globalThis : window);
