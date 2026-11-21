/* Shared team-season presentation and Nongshim Cup gauntlet diagrams.
 * Statistics use recorded games and source standings only; missing team/board
 * assignments are never inferred. */
(function (root) {
  'use strict';
  const M = typeof module !== 'undefined' && module.exports ? require('./viewer-model.js') : root.GoViewerModel;
  const esc = M.escape, states = new Map(), PAGE_SIZE = 20;
  const STAGE_NAMES = ['第一阶段', '第二阶段', '第三阶段', '第四阶段'];
  const STAGE_GAP_DAYS = 10;

  const isNongshim = data => data?.tournament?.id === 'nongshim';
  const hasNongshimTies = data => isNongshim(data) && (data?.team_competition?.ties?.length || 0) > 0;
  const isScheduledRound = r => !r.matches?.length && /^待赛(?:[｜|]|$)/.test(r.schedule_note || '');
  const isDateArchive = r => /赛段未载|来源未记?载赛段|赛果记录/.test(r.round_name || '')
    || /^(?:循环赛｜)?(?:常规赛|季后赛)$/.test(r.round_name || '');
  const standingsLabels = {regular: '常规赛', final_championship: '总决赛争冠组', final_placement: '总决赛排位组'};

  function roundPhase(round) {
    const name = round.round_name || '';
    if (name.includes('总决赛争冠组')) return 'final_championship';
    if (name.includes('总决赛排位组')) return 'final_placement';
    return /季后赛|总决赛|半决赛|决赛|保级|争冠|名次赛/.test(name) ? 'playoff' : 'regular';
  }

  function season(data) {
    const rounds = (data.rounds || []).filter(r => !M.isPrelimRound(r) && !M.isUnclassifiedRound(r) && !isScheduledRound(r));
    if (data.tournament?.id === 'cwql') rounds.sort((a,b) => Number(isDateArchive(a)) - Number(isDateArchive(b)));
    const schedule = (data.rounds || []).filter(isScheduledRound);
    const games = rounds.flatMap(r => r.matches || []);
    const matches = new Map(games.map(g => [g.id, g]));
    const teams = data.team_competition?.teams || [];
    const ties = (data.team_competition?.ties || []).filter(t => rounds.some(r => r.id === t.round_id));
    const assigned = new Set(ties.flatMap(t => (t.boards || []).map(b => b.id)));
    const useVerifiedBoards = data.tournament?.id === 'cwql' && assigned.size > 0;
    const counts = {decided: 0, no_result: 0, scheduled: 0, pending: 0, sgf: 0};
    const players = new Map();
    for (const game of games) {
      const status = M.matchStatus(game), winner = game.winner?.id || game.winner_id;
      counts[status]++; if (game.sgf?.present) counts.sgf++;
      const pair = M.participants(game), validWinner = pair.some(p => p.id && p.id === winner);
      if (pair.some(M.isGroupedPlayerLabel) || (useVerifiedBoards && !assigned.has(game.id))) continue;
      for (const p of pair.filter((p, i) => p.id && pair.findIndex(q => q.id === p.id) === i)) {
        if (!players.has(p.id)) players.set(p.id, {player: p, games: 0, wins: 0, losses: 0, noResult: 0, pending: 0});
        const row = players.get(p.id); row.games++;
        if (status === 'no_result') row.noResult++;
        else if (status === 'decided' && validWinner) { if (p.id === winner) row.wins++; else row.losses++; }
        else row.pending++;
      }
    }
    const isDraw = tie => Number.isFinite(tie.score_1) && tie.score_1 === tie.score_2 && !tie.winner_team_id
      && tie.boards?.length > 0 && tie.boards.every(b => matches.has(b.id) && M.hasResult(matches.get(b.id)));
    return {rounds, schedule, games, matches, teams, ties, assigned, counts, isDraw,
      loose: games.filter(g => !assigned.has(g.id)),
      players: [...players.values()].sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.player.name_zh?.localeCompare(b.player.name_zh || '', 'zh-CN'))};
  }

  function stateFor(data) {
    const id = data.edition.id;
    if (!states.has(id)) {
      states.set(id, {
        view: hasNongshimTies(data) ? 'bracket' : 'overview',
        layout: 'table',
        round: '', standingPhase: '', standingRound: null, expanded: new Set(), playerPage: 0, gamePage: 0, loose: false
      });
    }
    return states.get(id);
  }

  function diffDays(a, b) {
    const ka = M.dateKey(a), kb = M.dateKey(b);
    if (!ka || !kb) return 0;
    return Math.round((Date.parse(kb + 'T00:00:00Z') - Date.parse(ka + 'T00:00:00Z')) / 86400000);
  }

  function shortDate(value) {
    const key = M.dateKey(value);
    return key ? key.slice(5) : String(value || '').trim();
  }

  function stageDateRange(games) {
    const keys = games.map(g => M.dateKey(g.date)).filter(Boolean);
    if (!keys.length) return '';
    return keys[0] === keys[keys.length - 1] ? keys[0] : `${keys[0]} ～ ${keys[keys.length - 1]}`;
  }

  function winnerColor(match, winnerId) {
    if (!match || !winnerId) return '';
    if (match.black_player_id === winnerId) return 'black';
    if (match.white_player_id === winnerId) return 'white';
    return '';
  }

  function conciseResult(match) {
    if (!match) return '—';
    if (M.matchStatus(match) !== 'decided') return M.matchResult(match);
    return String(match.result_detail || match.result_type || '胜').replace(/^(?:执)?[黑白](?:方)?/, '') || '胜';
  }

  /** Build a DOM-free gauntlet model for Nongshim Cup editions from recorded ties. */
  function nongshimModel(data) {
    const nonPrelim = (data.rounds || []).filter(r => !M.isPrelimRound(r));
    const matchesById = new Map(nonPrelim.flatMap(r => r.matches || []).map(m => [m.id, m]));
    for (const r of data.rounds || []) {
      for (const m of r.matches || []) if (!matchesById.has(m.id)) matchesById.set(m.id, m);
    }
    const teams = (data.team_competition?.teams || []).slice();
    const teamsById = new Map(teams.map(t => [t.id, t]));
    const playersById = new Map();
    const rememberPlayer = p => { if (p && p.id && !playersById.has(p.id)) playersById.set(p.id, p); };
    for (const p of data.roster || []) rememberPlayer(p);
    for (const t of teams) for (const p of t.players || []) rememberPlayer(p);
    for (const m of matchesById.values()) {
      rememberPlayer(m.black_player); rememberPlayer(m.white_player); rememberPlayer(m.winner);
    }

    const ties = (data.team_competition?.ties || []).slice()
      .sort((a, b) => Number(a.tie_number || 0) - Number(b.tie_number || 0));
    const games = [];
    let streakId = 0, prevWinnerId = null, streakCount = 0;

    for (const tie of ties) {
      const board = tie.boards?.[0];
      if (!board) continue;
      const match = matchesById.get(board.id) || {id: board.id};
      const winTeamId = tie.winner_team_id || tie.team_1_id;
      const loseTeamId = tie.team_2_id === winTeamId ? tie.team_1_id : tie.team_2_id;
      const winnerTeam = teamsById.get(winTeamId) || null;
      const loserTeam = teamsById.get(loseTeamId) || null;
      const pair = M.participants(match);
      const winPlayerId = board.team_1_player_id || match.winner_id || match.winner?.id;
      const losePlayerId = board.team_2_player_id || pair.find(p => p.id && p.id !== winPlayerId)?.id;
      const winnerPlayer = playersById.get(winPlayerId) || pair.find(p => p.id === winPlayerId) || {id: winPlayerId, name_zh: '—'};
      const loserPlayer = playersById.get(losePlayerId) || pair.find(p => p.id === losePlayerId) || {id: losePlayerId, name_zh: '—'};
      if (winPlayerId && winPlayerId === prevWinnerId) streakCount++;
      else { streakId++; streakCount = 1; prevWinnerId = winPlayerId; }
      games.push({
        tieNumber: Number(tie.tie_number || games.length + 1),
        tie, match, winnerTeam, loserTeam, winnerPlayer, loserPlayer,
        date: match.date || '', color: winnerColor(match, winPlayerId),
        conciseResult: conciseResult(match),
        movesCount: match.moves_count || null,
        streak: streakCount, streakId,
        streakStart: streakCount === 1, streakLength: 1,
        isFinalDecider: false, isChampionStreak: false
      });
    }

    // Backfill each streak group's total length for vertical rowspan merging.
    for (let i = games.length - 1; i >= 0; i--) {
      if (i < games.length - 1 && games[i].streakId === games[i + 1].streakId) {
        games[i].streakLength = games[i + 1].streakLength;
      } else {
        games[i].streakLength = games[i].streak;
      }
    }

    const championTeam = teams.find(t => t.finish_rank === 1) || null;
    if (championTeam && games.length && games[games.length - 1].winnerTeam?.id === championTeam.id) {
      const finalGame = games[games.length - 1];
      finalGame.isFinalDecider = true;
      for (const g of games) {
        if (g.streakId === finalGame.streakId) g.isChampionStreak = true;
      }
    }

    // Group games into stages by inter-stage date breaks (>= 10 days).
    const stages = [];
    for (const g of games) {
      const prev = stages.length ? stages[stages.length - 1].games.at(-1) : null;
      if (!stages.length || (prev && diffDays(prev.date, g.date) >= STAGE_GAP_DAYS)) {
        const index = stages.length + 1;
        stages.push({index, title: STAGE_NAMES[index - 1] || `第${index}阶段`, games: []});
      }
      stages[stages.length - 1].games.push(g);
    }

    // Build Wikipedia-style stepladder rows & rowspan columns per stage.
    let carryWinner = null;
    for (const stage of stages) {
      stage.dateRange = stageDateRange(stage.games);
      const players = [], seen = new Set();
      const addPlayer = (player, team, carried = false) => {
        const id = player?.id || player?.name_zh;
        if (!id || seen.has(id)) return;
        seen.add(id);
        players.push({player, team, carried});
      };
      if (carryWinner) addPlayer(carryWinner.player, carryWinner.team, true);
      for (const g of stage.games) {
        addPlayer(g.winnerPlayer, g.winnerTeam, false);
        addPlayer(g.loserPlayer, g.loserTeam, false);
      }
      const rowIndex = new Map(players.map((entry, idx) => [entry.player?.id || entry.player?.name_zh, idx]));
      const columns = stage.games.map((g, colIdx) => {
        const wRow = rowIndex.get(g.winnerPlayer?.id || g.winnerPlayer?.name_zh) ?? 0;
        const lRow = rowIndex.get(g.loserPlayer?.id || g.loserPlayer?.name_zh) ?? 0;
        const spanRows = Math.max(colIdx + 2, wRow + 1, lRow + 1);
        return {game: g, colIdx, spanRows};
      });
      stage.players = players;
      stage.columns = columns;
      const last = stage.games.at(-1);
      carryWinner = last ? {player: last.winnerPlayer, team: last.winnerTeam} : null;
    }

    // Team records & ordered player stats.
    const teamStats = new Map(teams.map(t => [t.id, {
      team: t, wins: 0, losses: 0, order: [], byPlayer: new Map()
    }]));
    const ensurePlayerStat = (teamId, player) => {
      const entry = teamStats.get(teamId);
      if (!entry || !player) return null;
      const pid = player.id || player.name_zh;
      if (!entry.byPlayer.has(pid)) {
        const stat = {player, wins: 0, losses: 0, active: false};
        entry.byPlayer.set(pid, stat);
        entry.order.push(stat);
      }
      return entry.byPlayer.get(pid);
    };
    for (const g of games) {
      if (g.winnerTeam && teamStats.has(g.winnerTeam.id)) {
        teamStats.get(g.winnerTeam.id).wins++;
        const ws = ensurePlayerStat(g.winnerTeam.id, g.winnerPlayer);
        if (ws) ws.wins++;
      }
      if (g.loserTeam && teamStats.has(g.loserTeam.id)) {
        teamStats.get(g.loserTeam.id).losses++;
        const ls = ensurePlayerStat(g.loserTeam.id, g.loserPlayer);
        if (ls) ls.losses++;
      }
    }
    const lastWinnerId = games.at(-1)?.winnerPlayer?.id;
    for (const entry of teamStats.values()) {
      for (const p of entry.team.players || []) ensurePlayerStat(entry.team.id, p);
      for (const stat of entry.order) {
        stat.active = stat.losses === 0 && (stat.wins > 0 || stat.player?.id === lastWinnerId);
      }
    }
    const regionOrder = {KOR: 1, CHN: 2, JPN: 3};
    const teamSummary = [...teamStats.values()].sort((a, b) =>
      (a.team.finish_rank ?? 99) - (b.team.finish_rank ?? 99)
      || b.wins - a.wins || a.losses - b.losses
      || (regionOrder[a.team.region] || 9) - (regionOrder[b.team.region] || 9));

    return {teams: teamSummary, games, stages, championTeam, completed: Boolean(championTeam)};
  }

  function revealMatch(data, id) {
    if (hasNongshimTies(data)) {
      const model = nongshimModel(data);
      if (model.games.some(g => g.match?.id === id)) {
        const state = stateFor(data);
        if (state.view === 'bracket') return true;
      }
    }
    const s = season(data), round = s.rounds.find(r => r.matches.some(g => g.id === id));
    if (!round) return false;
    const state = stateFor(data), tie = s.ties.find(t => t.boards.some(b => b.id === id));
    state.view = 'round'; state.round = round.id;
    if (tie) state.expanded.add(tie.id); else state.loose = true;
    const loose = round.matches.filter(g => !s.assigned.has(g.id));
    state.gamePage = Math.floor(Math.max(0, loose.findIndex(g => g.id === id)) / PAGE_SIZE);
    return true;
  }

  function stoneHtml(color) {
    return color ? `<i class="stone-icon stone-${color}" aria-hidden="true"></i>` : '';
  }

  function renderNongshimBracket({data, block, state, flag, showPlayer, showMatch, rerender}) {
    const model = nongshimModel(data);
    const rankLabels = {1: '冠军', 2: '亚军', 3: '季军'};
    const playerBtn = (player, extraClass = '') => {
      const name = player?.name_zh || '—';
      if (!player?.id) return `<span class="nongshim-player-name ${extraClass}">${esc(name)}</span>`;
      return `<button type="button" class="nongshim-player-btn ${extraClass}" data-player-id="${esc(player.id)}" data-nongshim-player="${esc(player.id)}">${esc(name)}</button>`;
    };

    const layoutControls = [['table', '逐局连胜表'], ['ladder', '阶梯对阵']].map(([key, label]) =>
      `<button type="button" class="btn" data-nongshim-layout="${key}" aria-pressed="${state.layout === key}">${label}</button>`).join('');

    const teamsHtml = model.teams.map(t => {
      const rankTag = t.team.finish_rank ? rankLabels[t.team.finish_rank] || `第${t.team.finish_rank}名` : '';
      const playersList = t.order.map(stat => {
        const rec = `${stat.wins}胜${stat.losses}负`;
        return `<li class="nongshim-roster-item${stat.losses > 0 ? ' is-eliminated' : stat.active ? ' is-active' : ''}" data-nongshim-player="${esc(stat.player?.id || '')}">
          ${playerBtn(stat.player, 'nongshim-roster-player')}<span class="nongshim-roster-rec">${rec}</span>
        </li>`;
      }).join('');
      return `<div class="nongshim-team-card${t.team.finish_rank === 1 ? ' is-champion' : ''}">
        <div class="nongshim-team-head">
          <span class="nongshim-team-name">${t.team.region ? flag(t.team.region) : ''}<strong>${esc(t.team.name_zh)}</strong>${rankTag ? `<span class="nongshim-rank-badge${t.team.finish_rank === 1 ? ' is-champion' : ''}">${esc(rankTag)}</span>` : ''}</span>
          <span class="nongshim-team-score">${t.wins}胜 ${t.losses}负</span>
        </div>
        <ol class="nongshim-roster-list">${playersList || '<li class="nongshim-roster-empty">—</li>'}</ol>
      </div>`;
    }).join('');

    let diagramHtml = '';
    if (state.layout === 'table') {
      const rows = model.games.map((g, idx) => {
        const stage = model.stages.find(st => st.games[0] === g);
        const stageCell = stage ? `<th scope="rowgroup" rowspan="${stage.games.length}" class="nongshim-stage-cell"><strong>${esc(stage.title)}</strong>${stage.dateRange ? `<small>${esc(stage.dateRange)}</small>` : ''}</th>` : '';
        const winCell = g.streakStart ? `<td rowspan="${g.streakLength}" class="nongshim-streak-winner${g.isChampionStreak ? ' is-champion' : ''}" data-nongshim-player="${esc(g.winnerPlayer?.id || '')}">
          <div class="nongshim-cell-player">${g.winnerPlayer?.nationality ? flag(g.winnerPlayer.nationality) : ''}${playerBtn(g.winnerPlayer)}</div>
          ${g.streakLength >= 2 || g.isChampionStreak ? `<div class="nongshim-cell-badges">${g.streakLength >= 2 ? `<span class="nongshim-streak-badge">${g.streakLength}连胜</span>` : ''}${g.isChampionStreak ? `<span class="nongshim-champ-badge">夺冠</span>` : ''}</div>` : ''}
        </td>` : '';
        const resParts = [g.movesCount ? `${g.movesCount}手` : '', g.match ? M.matchResult(g.match) : '—'].filter(Boolean).join(' · ');
        return `<tr data-nongshim-row="${idx}">
          ${stageCell}
          <td class="nongshim-game-num">第${g.tieNumber}局</td>
          <td class="nongshim-game-date">${esc(M.dateLabel(g.date))}</td>
          ${winCell}
          <td class="nongshim-loser-cell" data-nongshim-player="${esc(g.loserPlayer?.id || '')}">
            <div class="nongshim-cell-player">${g.loserPlayer?.nationality ? flag(g.loserPlayer.nationality) : ''}${playerBtn(g.loserPlayer)}</div>
          </td>
          <td class="nongshim-result-cell">
            <button type="button" class="nongshim-result-btn" data-match-id="${esc(g.match.id)}" aria-label="第${g.tieNumber}局：${esc(g.winnerPlayer?.name_zh || '—')}胜${esc(g.loserPlayer?.name_zh || '—')}，${esc(resParts)}，查看详情">
              ${stoneHtml(g.color)}<span>${esc(resParts)}</span>
            </button>
          </td>
        </tr>`;
      }).join('');
      diagramHtml = `<div class="team-table-scroll" role="region" aria-label="农心杯逐局连胜表" tabindex="0">
        <table class="nongshim-streak-table">
          <caption class="sr-only">农心杯逐局连胜对阵表</caption>
          <thead><tr><th scope="col">阶段</th><th scope="col">局次</th><th scope="col">日期</th><th scope="col">获胜棋手</th><th scope="col">失利棋手</th><th scope="col">胜负</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    } else {
      diagramHtml = model.stages.map(stage => {
        const headCols = stage.columns.map(col =>
          `<th scope="col"><span>第${col.game.tieNumber}局</span>${col.game.date ? `<small>${esc(shortDate(col.game.date))}</small>` : ''}</th>`).join('');
        const bodyRows = stage.players.map((entry, rIdx) => {
          const p = entry.player, pid = p?.id || '';
          const cells = stage.columns.map(col => {
            const g = col.game;
            if (rIdx === 0) {
              const title = `第${g.tieNumber}局（${M.dateLabel(g.date)}）：${g.winnerPlayer?.name_zh || '—'} 胜 ${g.loserPlayer?.name_zh || '—'}（${M.matchResult(g.match)}）`;
              return `<td rowspan="${col.spanRows}" class="nongshim-step-cell${g.isFinalDecider ? ' is-champion' : ''}" data-match-id="${esc(g.match.id)}" data-nongshim-player="${esc(g.winnerPlayer?.id || '')}">
                <button type="button" class="nongshim-step-btn" title="${esc(title)}" aria-label="${esc(title)}，查看详情">
                  <span class="nongshim-step-winner">${g.winnerPlayer?.nationality ? flag(g.winnerPlayer.nationality) : ''}<span class="nongshim-step-name">${esc(g.winnerPlayer?.name_zh || '—')}</span></span>
                  <span class="nongshim-step-meta">${stoneHtml(g.color)}<span>${esc(g.conciseResult)}</span>${g.streak >= 2 ? `<span class="nongshim-streak-badge">${g.streak}连胜</span>` : ''}${g.isFinalDecider ? '<span class="nongshim-champ-badge">夺冠</span>' : ''}</span>
                </button>
              </td>`;
            }
            if (rIdx < col.spanRows) return '';
            return '<td class="nongshim-step-empty" aria-hidden="true"></td>';
          }).join('');
          return `<tr>
            <th scope="row" class="nongshim-ladder-player" data-nongshim-player="${esc(pid)}">
              <div class="nongshim-cell-player">${p?.nationality ? flag(p.nationality) : ''}${playerBtn(p)}${entry.carried ? '<span class="nongshim-carry-tag">守擂</span>' : ''}</div>
            </th>${cells}
          </tr>`;
        }).join('');
        const gameRange = stage.games.length === 1
          ? `第${stage.games[0].tieNumber}局`
          : `第${stage.games[0].tieNumber}–${stage.games.at(-1).tieNumber}局`;
        return `<section class="nongshim-stage">
          <div class="nongshim-stage-head"><h3>${esc(stage.title)}</h3><span>${esc([stage.dateRange, gameRange].filter(Boolean).join(' · '))}</span></div>
          <div class="team-table-scroll" role="region" aria-label="${esc(stage.title)}阶梯对阵图" tabindex="0">
            <table class="nongshim-ladder-table">
              <caption class="sr-only">${esc(stage.title)}阶梯对阵图</caption>
              <thead><tr><th scope="col" class="nongshim-ladder-corner">棋手</th>${headCols}</tr></thead>
              <tbody>${bodyRows}</tbody>
            </table>
          </div>
        </section>`;
      }).join('');
    }

    const metaParts = [`${model.teams.length} 队`, `${model.games.length} 局`, model.completed ? `${model.stages.length} 阶段` : '进行中'];
    block.classList.add('nongshim-results');
    block.dataset.nongshimLayout = state.layout;
    block.insertAdjacentHTML('beforeend', `<section class="nongshim-bracket" data-nongshim-layout="${esc(state.layout)}">
      <header class="nongshim-header">
        <div><h2 class="team-view-title">擂台赛对阵图</h2><p class="nongshim-meta">${esc(metaParts.join(' · '))}</p></div>
        <div class="nongshim-controls team-controls" role="group" aria-label="农心杯对阵图样式">${layoutControls}</div>
      </header>
      <div class="nongshim-teams-strip">${teamsHtml}</div>
      <div class="nongshim-stages">${diagramHtml}</div>
    </section>`);

    const bracket = block.querySelector('.nongshim-bracket');
    const byMatchId = new Map(model.games.map(g => [g.match.id, g.match]));
    const setActivePlayer = pid => {
      bracket.querySelectorAll('.is-player-active').forEach(el => el.classList.remove('is-player-active'));
      if (!pid) return;
      const safe = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(pid) : String(pid).replace(/"/g, '\\"');
      bracket.querySelectorAll(`[data-nongshim-player="${safe}"]`).forEach(el => el.classList.add('is-player-active'));
    };
    bracket.addEventListener('pointerover', event => {
      const target = event.target.closest('[data-nongshim-player]');
      setActivePlayer(target?.dataset.nongshimPlayer || '');
    });
    bracket.addEventListener('pointerleave', () => setActivePlayer(''));
    bracket.addEventListener('click', event => {
      const layoutBtn = event.target.closest('button[data-nongshim-layout]');
      if (layoutBtn) { state.layout = layoutBtn.dataset.nongshimLayout; rerender(); return; }
      const playerEl = event.target.closest('button[data-player-id]');
      if (playerEl) { showPlayer?.(playerEl.dataset.playerId); return; }
      const matchEl = event.target.closest('[data-match-id]');
      if (matchEl && byMatchId.has(matchEl.dataset.matchId)) showMatch?.(byMatchId.get(matchEl.dataset.matchId));
    });
  }

  function render(options) {
    const {data, canvas, mode, flag, wikiGame, modernGame, onDraw, showPlayer, showMatch} = options;
    const s = season(data), state = stateFor(data), byTeam = new Map(s.teams.map(t => [t.id, t]));
    const nongshimMode = hasNongshimTies(data);
    if ((!nongshimMode && state.view === 'bracket') || (!s.schedule.length && state.view === 'schedule')) state.view = 'overview';
    if (!s.rounds.some(r => r.id === state.round)) state.round = s.rounds[0]?.id || '';
    const roundIndex = s.rounds.findIndex(r => r.id === state.round), round = s.rounds[roundIndex];
    canvas.querySelectorAll('.round-col, .prelim-view').forEach(el => el.remove());
    const block = document.createElement('section'); block.className = 'round-col team-results';
    block.dataset.teamView = state.view;
    const rerender = () => {render(options); onDraw();};
    const teamName = id => byTeam.get(id)?.name_zh || '—';
    const teamFlag = id => byTeam.get(id)?.region ? flag(byTeam.get(id).region) : '';
    const tiedRounds = new Map(s.rounds.map(r => [r.id, r]));
    const fieldCoverage = s.games.length > 0 && !s.loose.length;
    const recordedTies = n => n || '—';
    const roundOption = r => `<option value="${esc(r.id)}"${r.id === round?.id ? ' selected' : ''}>${esc(r.round_name || '—')}${r.date_range ? ` · ${esc(r.date_range)}` : ''}</option>`;
    const roundOptions = () => {
      if (data.tournament.id !== 'cwql') return s.rounds.map(roundOption).join('');
      const groups = new Map();
      for (const r of s.rounds) {
        const phase = roundPhase(r);
        const label = isDateArchive(r) ? '按日期收录' : standingsLabels[phase] || '季后赛';
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(r);
      }
      return [...groups].map(([label, values]) => `<optgroup label="${esc(label)}">${values.map(roundOption).join('')}</optgroup>`).join('');
    };
    const button = (action, text, disabled = false) => `<button type="button" class="btn" data-team-action="${action}"${disabled ? ' disabled' : ''}>${text}</button>`;
    const pager = (kind, page, total) => `<div class="team-pagination team-controls">${button(`${kind}-prev`, '上一页', page <= 0)}<span>${page + 1} / ${Math.max(1, Math.ceil(total / PAGE_SIZE))} 页 · ${total} 条</span>${button(`${kind}-next`, '下一页', (page + 1) * PAGE_SIZE >= total)}</div>`;
    block.innerHTML = `<nav class="team-nav" aria-label="团体赛视图">${nongshimMode ? button('bracket', '对阵图') : ''}${button('overview', '赛季总览')}${button('round', '逐轮赛果', !s.rounds.length)}${s.schedule.length ? button('schedule', '待赛赛程') : ''}</nav>`;
    block.querySelector(`[data-team-action="${state.view}"]`)?.setAttribute('aria-current', 'page');
    const completed = s.counts.decided + s.counts.no_result;
    if (state.view === 'bracket' && nongshimMode) {
      renderNongshimBracket({data, block, state, flag, showPlayer, showMatch, rerender});
    } else if (state.view === 'schedule' && s.schedule.length) {
      block.insertAdjacentHTML('beforeend', `<section class="team-round-directory"><h2 class="team-view-title">待赛赛程</h2><div class="team-table-scroll"><table class="team-board-table"><thead><tr><th>轮次</th><th>计划日期</th><th>状态</th></tr></thead><tbody>${s.schedule.map(r => `<tr><td>${esc(r.round_name)}</td><td>${esc(r.date_range || '—')}</td><td>待赛</td></tr>`).join('')}</tbody></table></div></section>`);
    } else if (state.view === 'overview') {
      const stats = [['赛段', s.rounds.length], [fieldCoverage ? '场次' : '已录场次', recordedTies(s.ties.length)], [fieldCoverage ? '对局' : '已录对局', s.games.length], ['已录赛果', completed],
        [fieldCoverage ? '出场棋手' : '已录棋手', s.players.length], ['有胜负', s.counts.decided], ['无胜负', s.counts.no_result], ['待赛', s.counts.scheduled], ['赛果待补', s.counts.pending], ['已有棋谱', s.counts.sgf]];
      block.insertAdjacentHTML('beforeend', `<h2 class="team-view-title">赛季总览</h2><div class="team-season-stats">${stats.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
        ${s.loose.length ? `<p class="team-scope-note">${s.loose.length} 局未归入团体场次，可在对应轮次查看。</p>` : ''}`);
      const snapshots = data.team_competition?.standings || [];
      const phases = [...new Set(snapshots.map(r => r.phase))].sort((a, b) => Number(b === 'regular') - Number(a === 'regular'));
      if (!phases.includes(state.standingPhase)) state.standingPhase = phases[0] || '';
      const source = snapshots.filter(r => r.phase === state.standingPhase);
      const standingRounds = [...new Set(source.map(r => r.after_round))].sort((a,b) => b - a);
      const standingRound = standingRounds.includes(state.standingRound) ? state.standingRound : standingRounds[0];
      const latest = source.filter(r => r.after_round === standingRound);
      const standingLabel = k => standingsLabels[k] || '积分榜';
      const afterRound = tie => {
        const r = tiedRounds.get(tie.round_id);
        if (data.tournament.id !== 'cwql') return r?.round_order;
        if (!r || roundPhase(r) !== state.standingPhase) return null;
        return Number(/第(\d+)轮/.exec(r.round_name)?.[1] || r.round_order);
      };
      const winsLabel = data.tournament.id === 'kb' ? '场胜数' : '场分';
      const rows = latest.length ? latest.slice().sort((a, b) => a.rank - b.rank).map(r => {
        const drawsFromTies = s.ties.filter(t => {
          const n = afterRound(t);
          return n != null && n <= r.after_round && s.isDraw(t) && [t.team_1_id, t.team_2_id].includes(r.team_id);
        }).length;
        const draws = data.tournament.id === 'cwql' && state.standingPhase === 'regular'
          && Number(data.edition.year) <= 2025 ? Math.max(0, r.after_round - r.tie_wins - r.tie_losses) : drawsFromTies;
        return `<tr><td>${r.rank}</td><td>${esc(teamName(r.team_id))}</td><td>${r.match_points}</td><td>${r.board_wins}</td><td>${r.tie_wins} / ${draws} / ${r.tie_losses}</td></tr>`;
      }).join('') : s.teams.slice().sort((a,b) => (a.finish_rank ?? Infinity) - (b.finish_rank ?? Infinity)).map(t => {
        const ties = s.ties.filter(x => [x.team_1_id, x.team_2_id].includes(t.id));
        const wins = ties.filter(x => x.winner_team_id === t.id).length, draws = ties.filter(s.isDraw).length;
        const losses = ties.filter(x => x.winner_team_id && x.winner_team_id !== t.id).length;
        return `<tr><td>${t.finish_rank ?? '—'}</td><td>${esc(t.name_zh)}</td><td>${ties.length ? `${wins} / ${draws} / ${losses}` : '—'}</td></tr>`;
      }).join('');
      block.insertAdjacentHTML('beforeend', `<section class="team-standing"><h3>${latest.length ? `${esc(standingLabel(state.standingPhase).replace(/^积分榜$/, ''))}积分榜 · 第${standingRound}轮` : '已收录队伍名次'}</h3>
        ${phases.length > 1 || standingRounds.length > 1 ? `<div class="team-controls">
          ${phases.length > 1 ? `<label>赛段 <select class="team-standing-phase">${phases.map(phase => `<option value="${esc(phase)}"${state.standingPhase === phase ? ' selected' : ''}>${esc(standingLabel(phase))}</option>`).join('')}</select></label>` : ''}
          ${standingRounds.length > 1 ? `<label>轮次 <select class="team-standing-round">${standingRounds.map(n => `<option value="${n}"${n === standingRound ? ' selected' : ''}>第${n}轮</option>`).join('')}</select></label>` : ''}</div>` : ''}
        ${s.teams.length ? `<div class="team-table-scroll"><table class="team-board-table"><thead><tr><th>名次</th><th>队伍</th>${latest.length ? `<th>${winsLabel}</th><th>胜局</th>` : ''}<th>场胜 / 平 / 负</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p>暂无队伍积分榜数据。</p>'}
        </section>`);
      const page = Math.min(state.playerPage, Math.max(0, Math.ceil(s.players.length / PAGE_SIZE) - 1)); state.playerPage = page;
      block.insertAdjacentHTML('beforeend', `<section class="team-player-stats"><h3>棋手战绩</h3><div class="team-table-scroll"><table class="team-board-table"><thead><tr><th>棋手</th><th>对局</th><th>胜</th><th>负</th><th>无胜负</th><th>待赛 / 待补</th><th>胜率</th></tr></thead><tbody>${s.players.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(r => `<tr><td><button class="team-player" type="button" data-player-id="${esc(r.player.id)}">${esc(r.player.name_zh || '—')}</button></td><td>${r.games}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.noResult}</td><td>${r.pending}</td><td>${r.wins + r.losses ? (100 * r.wins / (r.wins + r.losses)).toFixed(1) + '%' : '—'}</td></tr>`).join('')}</tbody></table></div><p class="team-scope-note">胜率按已分胜负的对局计算。</p>${pager('player', page, s.players.length)}</section>`);
      block.insertAdjacentHTML('beforeend', `<section class="team-round-directory"><h3>轮次目录</h3><div class="team-table-scroll"><table class="team-board-table"><thead><tr><th>轮次 / 赛段</th><th>日期</th><th>已录场次</th><th>已录对局</th><th>已录赛果</th></tr></thead><tbody>${s.rounds.map(r => `<tr><td><button type="button" class="team-round-link" data-team-round="${esc(r.id)}">${esc(r.round_name || '—')}</button></td><td>${esc(r.date_range || '—')}</td><td>${recordedTies(s.ties.filter(t => t.round_id === r.id).length)}</td><td>${r.matches.length}</td><td>${r.matches.filter(M.hasResult).length}</td></tr>`).join('')}</tbody></table></div></section>`);
    } else if (round) {
      const groups = s.ties.filter(t => t.round_id === round.id), loose = round.matches.filter(g => !s.assigned.has(g.id));
      block.insertAdjacentHTML('beforeend', `<div class="team-round-controls team-controls">${button('prev', '上一轮', roundIndex <= 0)}<label>轮次<select class="team-round-select" aria-label="选择轮次">${roundOptions()}</select></label>${button('next', '下一轮', roundIndex === s.rounds.length - 1)}</div><section class="team-round"><h2 class="team-view-title">${esc(round.round_name || '—')}</h2><p class="team-round-meta">${esc(round.date_range || '—')}${groups.length ? ` · ${groups.length} 场` : ''} · ${groups.length && !loose.length ? '' : '已录 '}${round.matches.length} 局${round.location ? ` · ${esc(round.location)}` : ''}</p><div class="team-ties-grid"></div></section>`);
      const grid = block.querySelector('.team-ties-grid');
      for (const tie of groups) {
        const open = state.expanded.has(tie.id), article = document.createElement('article');
        article.className = 'team-tie'; article.dataset.tieId = tie.id;
        const note = s.isDraw(tie) ? '和棋' : tie.score_1 === tie.score_2 && tie.winner_team_id
          ? `${data.tournament.id === 'cwql' ? '主将胜' : '胜方'}：${teamName(tie.winner_team_id)}` : '';
        if (!open) {
          const marks = (tie.boards || []).map(b => {
            const g = s.matches.get(b.id), status = g ? M.matchStatus(g) : 'pending';
            const winner = g?.winner?.id || g?.winner_id;
            const symbol = status === 'no_result' ? '—' : status === 'scheduled' ? '…' : status !== 'decided'
              || ![b.team_1_player_id, b.team_2_player_id].includes(winner) ? '?' : winner === b.team_1_player_id ? '○' : '×';
            const label = `第${b.board_number}台：${status === 'no_result' ? '无胜负' : status === 'scheduled' ? '待赛' : status === 'pending' ? '赛果待补' : symbol === '○' ? '上方队伍胜' : '上方队伍负'}`;
            return `<span class="series-outcome" title="${esc(label)}" aria-label="${esc(label)}">${symbol === '○' || symbol === '×' ? `<svg class="series-mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${symbol === '○' ? '<circle cx="12" cy="12" r="8" />' : '<path d="M4 4L20 20M20 4L4 20" />'}</svg>` : symbol}</span>`;
          }).join('');
          article.innerHTML = `<div class="team-tie-summary">${[tie.team_1_id, tie.team_2_id].map((id, i) => `<div class="team-tie-player${tie.winner_team_id === id ? ' team-winner' : ''}"><span>${teamFlag(id)}${esc(teamName(id))}</span><strong>${tie[i ? 'score_2' : 'score_1'] ?? '—'}</strong></div>`).join('')}<div class="team-tie-footer"><span class="series-outcomes" aria-label="逐台赛果，以上方队伍为准">${marks}</span></div></div>`;
        } else {
          article.innerHTML = `<h3 class="team-tie-title">${esc(teamName(tie.team_1_id))} ／ ${esc(teamName(tie.team_2_id))}</h3>`;
          for (const board of tie.boards || []) {
            const game = s.matches.get(board.id);
            if (game) appendGame(article, game, `第${board.board_number}台`);
            else article.insertAdjacentHTML('beforeend', `<p>第${board.board_number}台：暂无对局资料</p>`);
          }
        }
        if (note) article.insertAdjacentHTML('beforeend', `<p class="team-tie-note">${esc(note)}</p>`);
        const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'series-toggle team-controls';
        toggle.textContent = open ? '收起' : '展开'; toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', `${open ? '收起' : '展开'}${teamName(tie.team_1_id)}对${teamName(tie.team_2_id)}逐台比赛`);
        toggle.onclick = () => {if (open) state.expanded.delete(tie.id); else state.expanded.add(tie.id); rerender();};
        article.append(toggle); grid.append(article);
      }
      if (loose.length) {
        const section = document.createElement('section'); section.className = 'team-unassigned';
        section.innerHTML = `<h3>${groups.length ? '其他对局' : '本轮对局'}</h3><p class="team-scope-note">${groups.length ? '未归入团体场次的对局。' : '按轮次展示各局赛果。'}</p>`;
        if (groups.length && !state.loose) {
          section.insertAdjacentHTML('beforeend', button('loose', `查看 ${loose.length} 局`));
        } else {
          const page = Math.min(state.gamePage, Math.max(0, Math.ceil(loose.length / PAGE_SIZE) - 1)); state.gamePage = page;
          const games = document.createElement('div'); games.className = 'team-games-grid';
          loose.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach(g => appendGame(games, g, g.bracket_code || '对局'));
          section.append(games); section.insertAdjacentHTML('beforeend', pager('game', page, loose.length));
        }
        block.append(section);
      }
    } else block.insertAdjacentHTML('beforeend', '<p>暂无轮次资料。</p>');
    function appendGame(parent, game, label) {
      const wrapper = document.createElement('div'); wrapper.className = 'team-game';
      wrapper.innerHTML = `<div class="wiki-game-heading"><span>${esc(label)}</span><span>${esc(M.dateLabel(game.date))}</span></div>`;
      wrapper.append(mode === 'wiki' ? wikiGame(game, 0, {singleGame: true}) : modernGame(game, false, false, true));
      if (M.matchStatus(game) !== 'decided') wrapper.insertAdjacentHTML('beforeend', `<p class="team-game-status">${esc(M.matchResult(game))}</p>`);
      parent.append(wrapper);
    }
    canvas.append(block);
    block.querySelectorAll('[data-player-id].team-player').forEach(el => el.onclick = () => showPlayer(el.dataset.playerId));
    block.querySelectorAll('[data-team-round]').forEach(el => el.onclick = () => {state.view = 'round'; state.round = el.dataset.teamRound; state.gamePage = 0; state.loose = false; rerender();});
    block.querySelector('.team-round-select')?.addEventListener('change', event => {state.round = event.target.value; state.gamePage = 0; state.loose = false; rerender();});
    block.querySelector('.team-standing-phase')?.addEventListener('change', event => {state.standingPhase = event.target.value; state.standingRound = null; rerender();});
    block.querySelector('.team-standing-round')?.addEventListener('change', event => {state.standingRound = Number(event.target.value); rerender();});
    block.querySelectorAll('[data-team-action]').forEach(el => el.onclick = () => {
      const action = el.dataset.teamAction;
      if (['bracket', 'overview', 'round', 'schedule'].includes(action)) state.view = action;
      else if (action === 'prev' || action === 'next') {state.round = s.rounds[roundIndex + (action === 'next' ? 1 : -1)].id; state.gamePage = 0; state.loose = false;}
      else if (action === 'loose') state.loose = true;
      else if (action.startsWith('player-')) state.playerPage += action.endsWith('next') ? 1 : -1;
      else if (action.startsWith('game-')) state.gamePage += action.endsWith('next') ? 1 : -1;
      rerender();
    });
  }
  const api = {season, nongshimModel, render, revealMatch};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GoViewerTeam = api;
})(typeof window === 'undefined' ? globalThis : window);
