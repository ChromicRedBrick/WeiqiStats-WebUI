/* Shared team-season presentation and Nongshim Cup gauntlet diagrams.
 * Statistics use recorded games and source standings only; missing team/board
 * assignments are never inferred. */
(function (root) {
  'use strict';
  const M = typeof module !== 'undefined' && module.exports ? require('./viewer-model.js') : root.GoViewerModel;
  const esc = M.escape, states = new Map(), PAGE_SIZE = 20;
  const STAGE_NAMES = ['第一阶段', '第二阶段', '第三阶段', '第四阶段'];
  const STAGE_GAP_DAYS = 10;

  const RELAY_TOURNAMENTS = new Set([
    'nongshim', 'jinro', 'sbs_world', 'zhengguanzhuang', 'huanglongshi',
    'cn_jp_super', 'bw_t_e4481646f0', 'bw_t_951332c48b', 'bw_t_216db9a7f0'
  ]);
  const isNongshim = data => RELAY_TOURNAMENTS.has(data?.tournament?.id);
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
    // Team rosters and per-member records come from recorded boards only. A
    // player who never appears remains a member with zero games if the roster
    // was imported explicitly.
    const playerById = new Map();
    const remember = p => { if (p?.id && !playerById.has(p.id)) playerById.set(p.id, p); };
    for (const p of data.roster || []) remember(p);
    for (const team of teams) for (const p of team.players || []) remember(p);
    for (const game of games) {
      M.participants(game).forEach(remember);
      remember(game.winner);
    }
    const teamRecords = new Map();
    for (const team of teams) {
      const rows = new Map();
      for (const p of team.players || []) {
        if (p?.id) rows.set(p.id, {player: p, games: 0, wins: 0, losses: 0, noResult: 0, pending: 0});
      }
      teamRecords.set(team.id, {ties: 0, wins: 0, draws: 0, losses: 0, unresolved: 0,
        boardWins: 0, boardLosses: 0, players: rows});
    }
    for (const tie of ties) {
      // Future ties may be listed before boards or a winner exist; they are
      // not part of the team record yet.
      if (!(tie.boards?.length) && !tie.winner_team_id) continue;
      const first = teamRecords.get(tie.team_1_id), second = teamRecords.get(tie.team_2_id);
      if (first) {
        first.ties++;
        first.boardWins += Number(tie.score_1) || 0;
        first.boardLosses += Number(tie.score_2) || 0;
      }
      if (second) {
        second.ties++;
        second.boardWins += Number(tie.score_2) || 0;
        second.boardLosses += Number(tie.score_1) || 0;
      }
      const winnerTeamId = tie.winner_team_id;
      if (winnerTeamId) {
        const winner = winnerTeamId === tie.team_1_id ? first : winnerTeamId === tie.team_2_id ? second : null;
        const loser = winnerTeamId === tie.team_1_id ? second : winnerTeamId === tie.team_2_id ? first : null;
        if (winner) winner.wins++; else { if (first) first.unresolved++; if (second) second.unresolved++; }
        if (loser) loser.losses++;
      } else if (isDraw(tie)) {
        if (first) first.draws++;
        if (second) second.draws++;
      } else {
        if (first) first.unresolved++;
        if (second) second.unresolved++;
      }
      for (const board of tie.boards || []) {
        const game = matches.get(board.id);
        const status = game ? M.matchStatus(game) : 'pending';
        const winner = game ? (game.winner?.id || game.winner_id || '') : '';
        const sides = [
          [tie.team_1_id, board.team_1_player_id, board.team_2_player_id],
          [tie.team_2_id, board.team_2_player_id, board.team_1_player_id]
        ];
        for (const [teamId, playerId, opponentId] of sides) {
          if (!playerId) continue;
          const record = teamRecords.get(teamId);
          if (!record) continue;
          let row = record.players.get(playerId);
          if (!row) {
            const player = playerById.get(playerId);
            if (!player) continue;
            row = {player, games: 0, wins: 0, losses: 0, noResult: 0, pending: 0};
            record.players.set(playerId, row);
          }
          row.games++;
          if (status === 'no_result') row.noResult++;
          else if (status === 'decided' && winner) {
            if (winner === playerId) row.wins++;
            else if (winner === opponentId) row.losses++;
            else row.pending++;
          } else row.pending++;
        }
      }
    }
    const memberOrder = p => {
      if (p?.member_order == null || p.member_order === '') return Infinity;
      const value = Number(p.member_order);
      return Number.isFinite(value) ? value : Infinity;
    };
    for (const record of teamRecords.values()) {
      record.playerRows = [...record.players.values()].sort((a, b) => {
        const orderA = memberOrder(a.player), orderB = memberOrder(b.player);
        if (orderA !== orderB) return orderA < orderB ? -1 : 1;
        return b.wins - a.wins || b.games - a.games
          || String(a.player.name_zh || '').localeCompare(String(b.player.name_zh || ''), 'zh-CN');
      });
    }
    return {rounds, schedule, games, matches, teams, ties, assigned, counts, isDraw, teamRecords,
      loose: games.filter(g => !assigned.has(g.id)),
      players: [...players.values()].sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.player.name_zh?.localeCompare(b.player.name_zh || '', 'zh-CN'))};
  }

  function stateFor(data) {
    const id = data.edition.id;
    if (!states.has(id)) {
      states.set(id, {
        view: hasNongshimTies(data) ? 'bracket' : 'overview',
        layout: 'lanes',
        selectedGame: null,
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

  function shortStageRange(games) {
    const keys = games.map(g => M.dateKey(g.date)).filter(Boolean);
    if (!keys.length) return '';
    if (keys[0] === keys[keys.length - 1]) return shortDate(keys[0]);
    const sameYear = keys[0].slice(0, 4) === keys[keys.length - 1].slice(0, 4);
    return sameYear ? `${shortDate(keys[0])} – ${shortDate(keys[keys.length - 1])}` : `${keys[0]} – ${keys[keys.length - 1]}`;
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

  function assignTeamColors(teamEntries) {
    const primaryTokens = {CHN: '--team-chn', KOR: '--team-kor', JPN: '--team-jpn'};
    const regionCounts = new Map();
    let otherCount = 0;
    for (const entry of teamEntries) {
      const region = String(entry.team?.region || '').trim().toUpperCase();
      let token = '--team-fallback';
      let alt = false;
      if (primaryTokens[region]) {
        const count = regionCounts.get(region) || 0;
        regionCounts.set(region, count + 1);
        alt = count > 0;
        token = alt ? `${primaryTokens[region]}-alt` : primaryTokens[region];
      } else if (region) {
        alt = otherCount > 0;
        token = otherCount === 0 ? '--team-other' : otherCount === 1 ? '--team-other-alt' : '--team-other-2';
        otherCount++;
      }
      entry.colorToken = token;
      entry.colorAlt = alt;
      entry.colorCss = `var(${token})`;
    }
  }

  function gameTooltip(g) {
    const datePart = g.date ? ` ${M.dateLabel(g.date)}` : '';
    if (g.isScheduled) {
      const teamsPart = [g.team1?.name_zh, g.team2?.name_zh].filter(Boolean).join(' 对 ');
      return `第${g.tieNumber}局${datePart}：${teamsPart ? `${teamsPart} · ` : ''}待赛`;
    }
    if (g.isNoResult || g.isPending) {
      const p1 = g.player1?.name_zh || g.team1?.name_zh || '—';
      const p2 = g.player2?.name_zh || g.team2?.name_zh || '—';
      const stateText = g.isNoResult ? '无胜负' : '赛果待补';
      return `第${g.tieNumber}局${datePart}：${p1} 对 ${p2} · ${stateText}${g.hasSgf ? ' · 有棋谱' : ''}`;
    }
    const colorPart = g.color ? `（执${g.color === 'black' ? '黑' : '白'}）` : ' ';
    const movesPart = g.movesCount ? ` · ${g.movesCount}手` : '';
    const sgfPart = g.hasSgf ? ' · 有棋谱' : '';
    return `第${g.tieNumber}局${datePart}：${g.winnerPlayer?.name_zh || '—'}${colorPart}${g.conciseResult} ${g.loserPlayer?.name_zh || '—'}${movesPart}${sgfPart}`;
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
    const streaks = [];
    const colorWins = {black: 0, white: 0};
    let streakId = 0;

    for (const tie of ties) {
      const board = tie.boards?.[0];
      const tieNumber = Number(tie.tie_number || games.length + 1);
      if (!board) {
        if (!tie.winner_team_id) {
          const team1 = teamsById.get(tie.team_1_id) || null;
          const team2 = teamsById.get(tie.team_2_id) || null;
          const scheduledGame = {
            tieNumber, tie, match: null, team1, team2, player1: null, player2: null,
            winnerTeam: null, loserTeam: null, winnerPlayer: null, loserPlayer: null,
            date: '', color: '', conciseResult: '待赛', movesCount: null, hasSgf: false,
            isNoResult: false, isPending: false, isScheduled: true, isDecided: false,
            streak: 0, streakId: 0, streakStart: false, streakLength: 0, endsStreak: 0,
            isFinalDecider: false, isChampionStreak: false
          };
          scheduledGame.tooltip = gameTooltip(scheduledGame);
          games.push(scheduledGame);
        }
        continue;
      }
      const match = matchesById.get(board.id) || {id: board.id};
      const status = M.matchStatus(match);
      const isNoResult = status === 'no_result';
      const isScheduled = status === 'scheduled';
      const isPending = status === 'pending';
      const isDecided = !isNoResult && !isScheduled && !isPending;
      const pair = M.participants(match);
      const hasSgf = Boolean(match.sgf?.present);

      if (!isDecided) {
        const team1 = teamsById.get(tie.team_1_id) || null;
        const team2 = teamsById.get(tie.team_2_id) || null;
        const p1Id = board.team_1_player_id;
        const p2Id = board.team_2_player_id;
        const player1 = p1Id ? (playersById.get(p1Id) || pair.find(p => p.id === p1Id) || {id: p1Id, name_zh: '—'}) : null;
        const player2 = p2Id ? (playersById.get(p2Id) || pair.find(p => p.id === p2Id) || {id: p2Id, name_zh: '—'}) : null;
        const voidGame = {
          tieNumber, tie, match, team1, team2, player1, player2,
          winnerTeam: null, loserTeam: null, winnerPlayer: null, loserPlayer: null,
          date: match.date || '', color: '', conciseResult: M.matchResult(match),
          movesCount: match.moves_count || null, hasSgf,
          isNoResult, isPending, isScheduled, isDecided: false,
          streak: 0, streakId: 0, streakStart: false, streakLength: 0, endsStreak: 0,
          isFinalDecider: false, isChampionStreak: false
        };
        voidGame.tooltip = gameTooltip(voidGame);
        games.push(voidGame);
        continue;
      }

      const team2Won = (tie.winner_team_id && tie.winner_team_id === tie.team_2_id)
        || (match.winner_id && match.winner_id === board.team_2_player_id && board.team_1_player_id !== match.winner_id);
      const winTeamId = team2Won ? tie.team_2_id : (tie.winner_team_id || tie.team_1_id);
      const loseTeamId = winTeamId === tie.team_1_id ? tie.team_2_id : tie.team_1_id;
      const winnerTeam = teamsById.get(winTeamId) || null;
      const loserTeam = teamsById.get(loseTeamId) || null;
      const winPlayerId = (team2Won ? board.team_2_player_id : board.team_1_player_id) || match.winner_id || match.winner?.id;
      const losePlayerId = (team2Won ? board.team_1_player_id : board.team_2_player_id) || pair.find(p => p.id && p.id !== winPlayerId)?.id;
      const winnerPlayer = playersById.get(winPlayerId) || pair.find(p => p.id === winPlayerId) || {id: winPlayerId, name_zh: '—'};
      const loserPlayer = playersById.get(losePlayerId) || pair.find(p => p.id === losePlayerId) || {id: losePlayerId, name_zh: '—'};
      const color = winnerColor(match, winPlayerId);
      if (color === 'black') colorWins.black++;
      else if (color === 'white') colorWins.white++;

      const game = {
        tieNumber, tie, match,
        team1: teamsById.get(tie.team_1_id) || winnerTeam,
        team2: teamsById.get(tie.team_2_id) || loserTeam,
        player1: winnerPlayer, player2: loserPlayer,
        winnerTeam, loserTeam, winnerPlayer, loserPlayer,
        date: match.date || '', color,
        conciseResult: conciseResult(match),
        movesCount: match.moves_count || null, hasSgf,
        isNoResult: false, isPending: false, isScheduled: false, isDecided: true,
        streak: 1, streakId: 0, streakStart: true, streakLength: 1, endsStreak: 0,
        isFinalDecider: false, isChampionStreak: false
      };

      const prevStreak = streaks.at(-1);
      if (prevStreak && winPlayerId && prevStreak.player?.id === winPlayerId) {
        prevStreak.to = tieNumber;
        prevStreak.games.push(game);
        prevStreak.length = prevStreak.games.length;
        game.streak = prevStreak.length;
        game.streakId = prevStreak.id;
        game.streakStart = false;
      } else {
        if (prevStreak && prevStreak.player?.id && prevStreak.player.id === losePlayerId) {
          prevStreak.endedByGame = tieNumber;
          if (prevStreak.length >= 2) game.endsStreak = prevStreak.length;
        }
        streakId++;
        game.streakId = streakId;
        streaks.push({
          id: streakId, player: winnerPlayer, team: winnerTeam,
          from: tieNumber, to: tieNumber, games: [game], length: 1,
          endedByGame: null, isLive: false, isChampionStreak: false
        });
      }
      game.tooltip = gameTooltip(game);
      games.push(game);
    }

    // Backfill each streak group's total length for legacy vertical rowspan merging.
    for (const s of streaks) {
      for (const g of s.games) g.streakLength = s.length;
    }

    const championTeam = teams.find(t => t.finish_rank === 1) || null;
    const completed = Boolean(championTeam);
    const lastDecided = [...games].reverse().find(g => g.isDecided) || null;
    if (completed && championTeam && lastDecided && lastDecided.winnerTeam?.id === championTeam.id) {
      lastDecided.isFinalDecider = true;
      const champStreak = streaks.find(s => s.id === lastDecided.streakId);
      if (champStreak) {
        champStreak.isChampionStreak = true;
        for (const g of champStreak.games) g.isChampionStreak = true;
      }
    }

    const activeChampion = !completed && streaks.length ? streaks[streaks.length - 1] : null;
    if (activeChampion) activeChampion.isLive = true;
    let longestStreak = null;
    let longestStreaks = [];
    for (const s of streaks) {
      if (!longestStreak || s.length > longestStreak.length) {
        longestStreak = s;
        longestStreaks = [s];
      } else if (s.length === longestStreak.length) {
        longestStreaks.push(s);
      }
    }

    // Group games into stages by inter-stage date breaks (>= 10 days); missing dates keep one stage.
    const stages = [];
    for (const g of games) {
      const prev = stages.length ? stages[stages.length - 1].games.at(-1) : null;
      const gap = prev && prev.date && g.date ? diffDays(prev.date, g.date) : 0;
      if (!stages.length || gap >= STAGE_GAP_DAYS) {
        const index = stages.length + 1;
        stages.push({index, title: STAGE_NAMES[index - 1] || `第${index}阶段`, games: [], gapCol: null});
      }
      stages[stages.length - 1].games.push(g);
    }

    // Assign CSS grid columns and preserve Wikipedia-style stepladder rows for retained 'ladder' view.
    let gridCol = 2;
    let carryWinner = null;
    for (let sIdx = 0; sIdx < stages.length; sIdx++) {
      const stage = stages[sIdx];
      if (sIdx > 0) stage.gapCol = gridCol++;
      stage.dateRange = stageDateRange(stage.games);
      stage.shortRange = shortStageRange(stage.games);
      const players = [], seen = new Set();
      const addPlayer = (player, team, carried = false) => {
        const id = player?.id || player?.name_zh;
        if (!id || seen.has(id)) return;
        seen.add(id);
        players.push({player, team, carried});
      };
      if (carryWinner) addPlayer(carryWinner.player, carryWinner.team, true);
      for (const g of stage.games) {
        g.gridCol = gridCol++;
        if (g.isDecided) {
          addPlayer(g.winnerPlayer, g.winnerTeam, false);
          addPlayer(g.loserPlayer, g.loserTeam, false);
        } else {
          if (g.player1) addPlayer(g.player1, g.team1, false);
          if (g.player2) addPlayer(g.player2, g.team2, false);
        }
      }
      const rowIndex = new Map(players.map((entry, idx) => [entry.player?.id || entry.player?.name_zh, idx]));
      const columns = stage.games.map((g, colIdx) => {
        const wRow = g.isDecided ? (rowIndex.get(g.winnerPlayer?.id || g.winnerPlayer?.name_zh) ?? 0) : 0;
        const lRow = g.isDecided ? (rowIndex.get(g.loserPlayer?.id || g.loserPlayer?.name_zh) ?? 0) : 0;
        const spanRows = Math.max(colIdx + 2, wRow + 1, lRow + 1);
        return {game: g, colIdx, spanRows};
      });
      stage.players = players;
      stage.columns = columns;
      const last = [...stage.games].reverse().find(g => g.isDecided);
      carryWinner = last ? {player: last.winnerPlayer, team: last.winnerTeam} : carryWinner;
    }
    const tailCol = activeChampion ? gridCol++ : null;

    // Team records & ordered player stats.
    const teamStats = new Map(teams.map(t => {
      const rawPlayers = (t.players || []).slice();
      const hasMemberOrder = rawPlayers.length > 0 && rawPlayers.every(p => p.member_order != null && Number.isFinite(Number(p.member_order)));
      const rosterSource = t.roster_source === 'members' ? 'members'
        : t.roster_source === 'games' ? 'games'
        : (rawPlayers.some(p => p.member_order != null) ? 'members' : 'games');
      if (hasMemberOrder) rawPlayers.sort((a, b) => Number(a.member_order) - Number(b.member_order));
      return [t.id, {
        team: t, wins: 0, losses: 0, order: [], byPlayer: new Map(),
        rosterSource, hasMemberOrder, rawPlayers
      }];
    }));
    const ensurePlayerStat = (teamId, player) => {
      const entry = teamStats.get(teamId);
      if (!entry || !player) return null;
      const pid = player.id || player.name_zh;
      if (!pid) return null;
      if (!entry.byPlayer.has(pid)) {
        const stat = {player, wins: 0, losses: 0, played: false, active: false, eliminatedAt: null, eliminatedBy: ''};
        entry.byPlayer.set(pid, stat);
        entry.order.push(stat);
      }
      return entry.byPlayer.get(pid);
    };
    for (const entry of teamStats.values()) {
      if (entry.hasMemberOrder) {
        for (const p of entry.rawPlayers) ensurePlayerStat(entry.team.id, p);
      }
    }
    for (const g of games) {
      if (g.isDecided) {
        if (g.winnerTeam && teamStats.has(g.winnerTeam.id)) {
          teamStats.get(g.winnerTeam.id).wins++;
          const ws = ensurePlayerStat(g.winnerTeam.id, g.winnerPlayer);
          if (ws) { ws.played = true; ws.wins++; }
        }
        if (g.loserTeam && teamStats.has(g.loserTeam.id)) {
          teamStats.get(g.loserTeam.id).losses++;
          const ls = ensurePlayerStat(g.loserTeam.id, g.loserPlayer);
          if (ls) {
            ls.played = true;
            ls.losses++;
            ls.eliminatedAt = g.tieNumber;
            ls.eliminatedBy = g.winnerPlayer?.name_zh || '—';
          }
        }
      } else if (!g.isScheduled) {
        if (g.team1 && g.player1 && teamStats.has(g.team1.id)) {
          const s1 = ensurePlayerStat(g.team1.id, g.player1);
          if (s1) s1.played = true;
        }
        if (g.team2 && g.player2 && teamStats.has(g.team2.id)) {
          const s2 = ensurePlayerStat(g.team2.id, g.player2);
          if (s2) s2.played = true;
        }
      }
    }
    const lastWinnerId = lastDecided?.winnerPlayer?.id;
    for (const entry of teamStats.values()) {
      for (const p of entry.rawPlayers) ensurePlayerStat(entry.team.id, p);
      delete entry.rawPlayers;
      for (const stat of entry.order) {
        stat.active = stat.played && stat.losses === 0 && (stat.wins > 0 || stat.player?.id === lastWinnerId);
      }
      entry.eliminatedCount = entry.order.filter(s => s.losses > 0).length;
      entry.totalMembers = entry.order.length;
      entry.remaining = entry.rosterSource === 'members' ? Math.max(0, entry.totalMembers - entry.eliminatedCount) : null;
      entry.allEliminated = entry.rosterSource === 'members' && entry.totalMembers > 0 && entry.remaining === 0;
      entry.eliminatedAtGame = entry.allEliminated
        ? (Math.max(0, ...entry.order.map(s => s.eliminatedAt || 0)) || null)
        : null;
    }
    const regionOrder = {KOR: 1, CHN: 2, JPN: 3};
    const teamSummary = [...teamStats.values()].sort((a, b) =>
      (a.team.finish_rank ?? 99) - (b.team.finish_rank ?? 99)
      || b.wins - a.wins || a.losses - b.losses
      || (regionOrder[a.team.region] || 9) - (regionOrder[b.team.region] || 9));
    teamSummary.forEach((entry, idx) => {
      entry.lane = idx + 1;
      entry.lanes = idx + 1;
      entry.gridRow = idx + 3;
    });
    assignTeamColors(teamSummary);

    return {
      teams: teamSummary, games, stages, streaks, championTeam, completed,
      activeChampion, longestStreak, longestStreaks, colorWins, tailCol
    };
  }

  function revealMatch(data, id) {
    if (hasNongshimTies(data)) {
      const model = nongshimModel(data);
      const target = model.games.find(g => g.match?.id === id);
      if (target) {
        const state = stateFor(data);
        if (state.view === 'bracket') {
          state.selectedGame = target.tieNumber;
          return true;
        }
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

  function renderSummary({model, flag, layoutControls}) {
    const statusText = model.completed
      ? `${model.stages.length} 阶段`
      : model.stages.length ? `进行中 · ${model.stages.at(-1).title}` : '进行中';
    const metaParts = [`${model.teams.length} 队`, `${model.games.length} 局`, statusText];
    const kpis = [];
    if (!model.completed && model.activeChampion) {
      const live = model.activeChampion;
      const livePid = live.player?.id || '';
      kpis.push(`<span class="nongshim-kpi is-live" data-nongshim-player="${esc(livePid)}">擂主 ${live.team?.region ? flag(live.team.region) : ''}<strong>${esc(live.player?.name_zh || '—')}</strong>${live.length >= 2 ? ` · ${live.length}连胜` : ''}</span>`);
    }
    if (model.longestStreaks?.length || model.longestStreak) {
      const tops = model.longestStreaks?.length ? model.longestStreaks : [model.longestStreak];
      const maxLen = tops[0].length;
      const seenTop = new Set();
      const uniqueTops = tops.filter(s => {
        const key = s.player?.id || s.player?.name_zh;
        if (!key) return true;
        if (seenTop.has(key)) return false;
        seenTop.add(key);
        return true;
      });
      if (uniqueTops.length === 1) {
        const top = uniqueTops[0];
        kpis.push(`<span class="nongshim-kpi" data-nongshim-player="${esc(top.player?.id || '')}">最长连胜 ${top.team?.region ? flag(top.team.region) : ''}<strong>${esc(top.player?.name_zh || '—')}</strong> ${maxLen}连胜</span>`);
      } else {
        const playersHtml = uniqueTops.map(s =>
          `<span class="nongshim-kpi-player" data-nongshim-player="${esc(s.player?.id || '')}">${s.team?.region ? flag(s.team.region) : ''}<strong>${esc(s.player?.name_zh || '—')}</strong></span>`
        ).join('');
        kpis.push(`<span class="nongshim-kpi is-tied">最长连胜 ${playersHtml}<span class="nongshim-kpi-tie">（并列）</span>${maxLen}连胜</span>`);
      }
    }
    if (model.colorWins.black + model.colorWins.white > 0) {
      kpis.push(`<span class="nongshim-kpi">${stoneHtml('black')}黑胜 ${model.colorWins.black}${stoneHtml('white')}白胜 ${model.colorWins.white}</span>`);
    }
    return `<header class="nongshim-summary">
      <div class="nongshim-header">
        <div>
          <h2 class="team-view-title">擂台赛对阵图</h2>
          <p class="nongshim-meta">${esc(metaParts.join(' · '))}</p>
        </div>
        <div class="nongshim-controls team-controls" role="group" aria-label="擂台赛视图样式">${layoutControls}</div>
      </div>
      ${kpis.length ? `<div class="nongshim-kpis">${kpis.join('')}</div>` : ''}
    </header>`;
  }

  function renderRosters({model, flag, playerBtn, rankLabels}) {
    let anyConfirmedAnchor = false;
    let anyConfirmedOrder = false;
    const cardsHtml = model.teams.map(t => {
      const rankTag = t.team.finish_rank ? rankLabels[t.team.finish_rank] || `第${t.team.finish_rank}名` : '';
      const unplayedCount = t.order.filter(s => !s.played).length;
      const isChampTeam = t.team.finish_rank === 1;
      const pipsHtml = t.order.map((stat, idx) => {
        const isOut = stat.losses > 0;
        const isLive = !model.completed && model.activeChampion && stat.player?.id && stat.player.id === model.activeChampion.player?.id && !isOut;
        const orderConfirmed = t.hasMemberOrder && (stat.played || (model.completed && isChampTeam && unplayedCount <= 1));
        if (orderConfirmed) anyConfirmedOrder = true;
        // 主将只认显式 role。未确定末位的队伍（如第4届日本）不得按 member_order 末位推断。
        const isAnchor = stat.player?.role === '主将';
        if (isAnchor) anyConfirmedAnchor = true;
        const tip = isOut
          ? `${stat.wins}胜${stat.losses}负 · 第${stat.eliminatedAt}局负于${stat.eliminatedBy}`
          : stat.wins > 0 ? `${stat.wins}胜` : '';
        const roleTag = isLive ? '<em class="nongshim-pip-tag is-live">擂主</em>'
          : isAnchor ? '<em class="nongshim-pip-tag is-anchor">主将</em>' : '';
        const idxBadge = orderConfirmed ? `<i class="nongshim-pip-idx">${idx + 1}</i>` : '';
        return `<li class="nongshim-roster-pip${isOut ? ' is-eliminated' : isLive ? ' is-live' : ''}${orderConfirmed ? '' : ' is-unordered'}" data-nongshim-player="${esc(stat.player?.id || '')}"${tip ? ` title="${esc(tip)}"` : ''}>
          ${idxBadge}${playerBtn(stat.player, 'nongshim-roster-player')}${roleTag}
        </li>`;
      }).join('');
      const leftHtml = t.rosterSource === 'members'
        ? `<span class="nongshim-team-left"><span class="nongshim-left-label">剩</span><strong class="nongshim-left-num">${t.remaining}</strong><span class="nongshim-left-total">/ ${t.totalMembers}</span></span>`
        : `<span class="nongshim-team-left"><span class="nongshim-left-label">已淘汰 ${t.eliminatedCount} 人</span></span>`;
      const outBadge = t.allEliminated && t.eliminatedAtGame
        ? `<span class="nongshim-out-badge">第${t.eliminatedAtGame}局出局</span>` : '';
      return `<div class="nongshim-team-card is-lanes${t.team.finish_rank === 1 ? ' is-champion' : ''}${t.allEliminated ? ' is-team-out' : ''}" style="--tc:${t.colorCss}">
        <div class="nongshim-team-head">
          <span class="nongshim-team-name">${t.team.region ? flag(t.team.region) : ''}<strong>${esc(t.team.name_zh)}</strong><span class="nongshim-team-record">${t.wins}胜${t.losses}负</span>${rankTag ? `<span class="nongshim-rank-badge${t.team.finish_rank === 1 ? ' is-champion' : ''}">${esc(rankTag)}</span>` : ''}${outBadge}</span>
          ${leftHtml}
        </div>
        <ol class="nongshim-roster-pips">${pipsHtml || '<li class="nongshim-roster-empty">—</li>'}</ol>
      </div>`;
    }).join('');
    const subText = anyConfirmedAnchor ? '主将仅在资料明确时标注；已出场按顺序排列' : anyConfirmedOrder ? '已出场按顺序排列' : '';
    return `<section class="nongshim-section" aria-labelledby="nongshimRostersTitle">
      <div class="nongshim-sec-head"><h3 id="nongshimRostersTitle">各队阵容</h3>${subText ? `<span class="nongshim-sec-sub">${subText}</span>` : ''}</div>
      <div class="nongshim-teams-strip nongshim-rosters" style="--nongshim-team-count:${Math.max(1, model.teams.length)}">${cardsHtml}</div>
    </section>`;
  }

  function renderLanes({model, flag, selectedGame}) {
    const teamById = new Map(model.teams.map(t => [t.team.id, t]));
    const colTokens = ['minmax(6.25rem, 7.25rem)'];
    for (let sIdx = 0; sIdx < model.stages.length; sIdx++) {
      if (sIdx > 0) colTokens.push('1.25rem');
      for (let i = 0; i < model.stages[sIdx].games.length; i++) {
        colTokens.push('minmax(var(--nongshim-col-min, 6.75rem), 1fr)');
      }
    }
    if (model.tailCol) colTokens.push('5.25rem');

    const parts = [];
    model.teams.forEach((t, idx) => {
      parts.push(`<div class="nongshim-lane-bg${idx % 2 ? ' is-alt' : ''}" style="grid-row:${t.gridRow}" aria-hidden="true"></div>`);
      const champMark = t.team.finish_rank === 1 ? '<span class="nongshim-champ-badge">冠军</span>' : '';
      parts.push(`<div class="nongshim-lane-name${t.team.finish_rank === 1 ? ' is-champion' : ''}" style="grid-row:${t.gridRow};--tc:${t.colorCss}"><span class="nongshim-lane-accent" aria-hidden="true"></span>${t.team.region ? flag(t.team.region) : ''}<span class="nongshim-lane-team">${esc(t.team.name_zh.replace(/队$/, ''))}</span>${champMark}</div>`);
    });

    model.stages.forEach((st, sIdx) => {
      if (st.gapCol) {
        parts.push(`<div class="nongshim-lane-gap" style="grid-column:${st.gapCol};grid-row:1/-1" aria-hidden="true"></div>`);
      }
      const firstCol = st.games[0]?.gridCol || 2;
      const lastCol = st.games.at(-1)?.gridCol || firstCol;
      const endCol = lastCol + 1 + (sIdx === model.stages.length - 1 && model.tailCol ? 1 : 0);
      parts.push(`<div class="nongshim-lane-stage" style="grid-row:1;grid-column:${firstCol}/${endCol}"><strong>${esc(st.title)}</strong>${st.shortRange ? `<span> · ${esc(st.shortRange)}</span>` : ''}</div>`);
    });

    const voidCols = new Set(model.games.filter(g => g.isNoResult || g.isPending || g.isScheduled).map(g => g.gridCol));
    const selClass = n => (selectedGame === n ? ' is-game-selected' : '');

    for (const g of model.games) {
      const c = g.gridCol;
      parts.push(`<button type="button" class="nongshim-lane-game${g.isScheduled ? ' is-scheduled' : ''}${selClass(g.tieNumber)}" data-nongshim-game="${g.tieNumber}" title="${esc(g.tooltip)}" aria-label="${esc(g.tooltip)}" style="grid-row:2;grid-column:${c}"><strong>第${g.tieNumber}局${g.hasSgf ? '<span class="nongshim-sgf-tag">谱</span>' : ''}</strong>${g.date ? `<small>${esc(shortDate(g.date))}</small>` : g.isScheduled ? '<small>待赛</small>' : ''}</button>`);
      if (g.isScheduled) {
        const endRow = 3 + Math.max(1, model.teams.length);
        parts.push(`<div class="nongshim-lane-scheduled${selClass(g.tieNumber)}" data-nongshim-game="${g.tieNumber}" title="${esc(g.tooltip)}" style="grid-column:${c};grid-row:3/${endRow}"><span>第${g.tieNumber}局 · 待赛</span></div>`);
        continue;
      }
      if (g.isNoResult || g.isPending) {
        const t1 = g.team1 ? teamById.get(g.team1.id) : null;
        const t2 = g.team2 ? teamById.get(g.team2.id) : null;
        const label = g.isNoResult ? '无胜负' : '待补';
        if (t1 && t2 && t1.gridRow !== t2.gridRow) {
          parts.push(`<div class="nongshim-lane-conn is-void${selClass(g.tieNumber)}" data-nongshim-game="${g.tieNumber}" style="grid-column:${c};grid-row:${Math.min(t1.gridRow, t2.gridRow)}/${Math.max(t1.gridRow, t2.gridRow) + 1}" aria-hidden="true"></div>`);
        }
        if (t1) {
          parts.push(`<div class="nongshim-lane-void${selClass(g.tieNumber)}" data-nongshim-game="${g.tieNumber}"${g.player1?.id ? ` data-nongshim-player="${esc(g.player1.id)}"` : ''} title="${esc(g.tooltip)}" style="grid-column:${c};grid-row:${t1.gridRow}">${label}</div>`);
        }
        if (t2) {
          parts.push(`<div class="nongshim-lane-void${selClass(g.tieNumber)}" data-nongshim-game="${g.tieNumber}"${g.player2?.id ? ` data-nongshim-player="${esc(g.player2.id)}"` : ''} title="${esc(g.tooltip)}" style="grid-column:${c};grid-row:${t2.gridRow}">${label}</div>`);
        }
        continue;
      }

      const wt = g.winnerTeam ? teamById.get(g.winnerTeam.id) : null;
      const lt = g.loserTeam ? teamById.get(g.loserTeam.id) : null;
      const wr = wt?.gridRow;
      const lr = lt?.gridRow;
      if (wr && lr && wr !== lr) {
        parts.push(`<div class="nongshim-lane-conn${selClass(g.tieNumber)}" data-nongshim-game="${g.tieNumber}" style="grid-column:${c};grid-row:${Math.min(wr, lr)}/${Math.max(wr, lr) + 1}" aria-hidden="true"></div>`);
      }
      if (wr && g.color) {
        const edge = lr && lr < wr ? 'is-up' : 'is-down';
        parts.push(`<button type="button" class="nongshim-lane-node ${edge}${g.isFinalDecider ? ' is-decider' : ''}${selClass(g.tieNumber)}" data-nongshim-game="${g.tieNumber}" title="${esc(g.tooltip)}" aria-label="${esc(g.tooltip)}" style="grid-column:${c};grid-row:${wr};--tc:${wt.colorCss}">${stoneHtml(g.color)}</button>`);
      }
      if (lr) {
        const endText = g.endsStreak >= 2 ? `<small>${g.endsStreak}连胜止</small>` : '';
        parts.push(`<button type="button" class="nongshim-lane-out${selClass(g.tieNumber)}" data-nongshim-game="${g.tieNumber}" data-nongshim-player="${esc(g.loserPlayer?.id || '')}" title="${esc(g.tooltip)}" aria-label="${esc(g.tooltip)}" style="grid-column:${c};grid-row:${lr};--tc:${lt.colorCss}"><span class="nongshim-out-name"><span class="nongshim-out-mark" aria-hidden="true">✕</span>${esc(g.loserPlayer?.name_zh || '—')}</span>${endText}</button>`);
      }
    }

    // Streak bars: span across stage gaps; break around no-result/pending gap columns.
    for (const s of model.streaks) {
      const teamEntry = s.team ? teamById.get(s.team.id) : null;
      if (!teamEntry) continue;
      const firstCol = s.games[0].gridCol;
      const lastCol = s.games.at(-1).gridCol;
      const segments = [];
      let segStart = firstCol;
      for (let col = firstCol; col <= lastCol; col++) {
        if (voidCols.has(col)) {
          if (col > segStart) segments.push({start: segStart, end: col});
          segStart = col + 1;
        }
      }
      if (segStart <= lastCol) segments.push({start: segStart, end: lastCol + 1});

      const tip = `${s.player?.name_zh || '—'}（${s.team?.name_zh || ''}）${s.length >= 2 ? `${s.length}连胜` : '1胜'}`;
      segments.forEach((seg, segIdx) => {
        const isLastSeg = segIdx === segments.length - 1;
        const badge = isLastSeg && s.length >= 2 ? `<span class="nongshim-streak-badge">${s.length}连胜</span>` : '';
        const champ = isLastSeg && s.isChampionStreak ? '<span class="nongshim-champ-badge">夺冠</span>' : '';
        const isAltLane = (teamEntry.lane - 1) % 2 === 1;
        const fadeSpan = isLastSeg && s.isLive ? '<span class="nongshim-bar-fade" aria-hidden="true"></span>' : '';
        parts.push(`<button type="button" class="nongshim-lane-bar${isLastSeg && s.isLive ? ' is-live' : ''}${isAltLane ? ' is-alt-lane' : ''}${s.isChampionStreak ? ' is-champion' : ''}" data-nongshim-player="${esc(s.player?.id || '')}" data-nongshim-game="${s.games[0].tieNumber}" title="${esc(tip)}" aria-label="${esc(tip)}" style="grid-row:${teamEntry.gridRow};grid-column:${seg.start}/${seg.end};--tc:${teamEntry.colorCss}">${s.team?.region ? flag(s.team.region) : ''}<span class="nongshim-bar-name">${esc(s.player?.name_zh || '—')}</span>${badge}${champ}${fadeSpan}</button>`);
      });
      if (s.isLive && model.tailCol) {
        parts.push(`<div class="nongshim-lane-tail" style="grid-row:${teamEntry.gridRow};grid-column:${model.tailCol};--tc:${teamEntry.colorCss}">守擂中 →</div>`);
      }
    }

    return `<section class="nongshim-section" aria-labelledby="nongshimLanesTitle">
      <div class="nongshim-sec-head"><h3 id="nongshimLanesTitle">擂台进程</h3><span class="nongshim-sec-sub">点击局次或节点可定位明细</span></div>
      <div class="nongshim-lanes-card">
        <div class="team-table-scroll nongshim-lanes-scroll" role="region" aria-label="擂台进程图" tabindex="0">
          <div class="nongshim-lanes${model.games.length > 10 ? ' is-compact' : ''}" style="grid-template-columns:${colTokens.join(' ')};grid-template-rows:auto auto repeat(${Math.max(1, model.teams.length)}, 3.5rem)">${parts.join('')}</div>
        </div>
        <div class="nongshim-legend">
          <span><span class="nongshim-legend-badge">N连胜</span>守擂连胜</span>
          <span>${stoneHtml('black')}${stoneHtml('white')}胜方执色</span>
          <span>✕ 被淘汰</span>
        </div>
      </div>
    </section>`;
  }

  function renderDetail({model, flag, playerBtn, selectedGame}) {
    const teamById = new Map(model.teams.map(t => [t.team.id, t]));
    const rows = [];
    for (const st of model.stages) {
      rows.push(`<tr class="nongshim-detail-stage"><td colspan="5"><strong>${esc(st.title)}</strong>${st.shortRange ? `<span> · ${esc(st.shortRange)}</span>` : ''}</td></tr>`);
      for (const g of st.games) {
        const sel = selectedGame === g.tieNumber ? ' is-game-selected' : '';
        const dateCell = esc(g.date ? M.dateLabel(g.date) : '—');
        if (g.isScheduled) {
          const pairText = [g.team1?.name_zh, g.team2?.name_zh].filter(Boolean).join(' 对 ') || '—';
          rows.push(`<tr class="nongshim-detail-row is-scheduled${sel}" data-nongshim-game="${g.tieNumber}"${g.match?.id ? ` data-match-id="${esc(g.match.id)}"` : ''}>
            <td class="nongshim-detail-num">第${g.tieNumber}局</td>
            <td class="nongshim-detail-date">${dateCell}</td>
            <td>${esc(pairText)}</td>
            <td>待赛</td>
            <td class="nongshim-detail-kifu"><span class="nongshim-kifu-none">无</span></td>
          </tr>`);
          continue;
        }
        if (g.isNoResult || g.isPending) {
          const p1Html = g.player1 ? `${g.team1?.region ? flag(g.team1.region) : ''}${playerBtn(g.player1)}` : esc(g.team1?.name_zh || '—');
          const p2Html = g.player2 ? `${g.team2?.region ? flag(g.team2.region) : ''}${playerBtn(g.player2)}` : esc(g.team2?.name_zh || '—');
          const kifu = g.hasSgf
            ? `<button type="button" class="nongshim-kifu-btn" data-sgf-match-id="${esc(g.match.id)}" aria-label="第${g.tieNumber}局有棋谱，点击查看">有</button>`
            : '<span class="nongshim-kifu-none">无</span>';
          rows.push(`<tr class="nongshim-detail-row is-void${sel}" data-nongshim-game="${g.tieNumber}"${g.match?.id ? ` data-match-id="${esc(g.match.id)}"` : ''}>
            <td class="nongshim-detail-num">第${g.tieNumber}局</td>
            <td class="nongshim-detail-date">${dateCell}</td>
            <td><span class="nongshim-detail-matchup"><span class="nongshim-detail-player" data-nongshim-player="${esc(g.player1?.id || '')}">${p1Html}</span><span class="nongshim-detail-vs">对</span><span class="nongshim-detail-player" data-nongshim-player="${esc(g.player2?.id || '')}">${p2Html}</span></span></td>
            <td>${g.isNoResult ? '无胜负' : '赛果待补'}</td>
            <td class="nongshim-detail-kifu">${kifu}</td>
          </tr>`);
          continue;
        }
        const wt = g.winnerTeam ? teamById.get(g.winnerTeam.id) : null;
        const winColorCss = wt?.colorCss || 'var(--team-fallback)';
        const badgeHtml = g.isFinalDecider
          ? '<span class="nongshim-champ-badge">夺冠</span>'
          : g.streak >= 2
          ? `<span class="nongshim-detail-badge">${g.streak}连胜</span>`
          : g.endsStreak >= 2
          ? `<span class="nongshim-detail-badge">终结${g.endsStreak}连胜</span>`
          : '';
        const colorPrefix = g.color === 'black' ? '执黑' : g.color === 'white' ? '执白' : '';
        const movesHtml = g.movesCount ? `<span class="nongshim-detail-moves"> · ${g.movesCount}手</span>` : '';
        const kifuHtml = g.hasSgf
          ? `<button type="button" class="nongshim-kifu-btn" data-sgf-match-id="${esc(g.match.id)}" aria-label="第${g.tieNumber}局有棋谱，点击查看">有</button>`
          : '<span class="nongshim-kifu-none">无</span>';
        rows.push(`<tr class="nongshim-detail-row${sel}" data-nongshim-game="${g.tieNumber}" data-match-id="${esc(g.match.id)}" style="--tc:${winColorCss}">
          <td class="nongshim-detail-num">第${g.tieNumber}局</td>
          <td class="nongshim-detail-date">${dateCell}</td>
          <td><span class="nongshim-detail-matchup">
            <span class="nongshim-detail-player is-winner" data-nongshim-player="${esc(g.winnerPlayer?.id || '')}">${g.winnerTeam?.region ? flag(g.winnerTeam.region) : (g.winnerPlayer?.nationality ? flag(g.winnerPlayer.nationality) : '')}${playerBtn(g.winnerPlayer)}</span>${badgeHtml}
            <span class="nongshim-detail-vs">胜</span>
            <span class="nongshim-detail-player is-loser" data-nongshim-player="${esc(g.loserPlayer?.id || '')}">${g.loserTeam?.region ? flag(g.loserTeam.region) : (g.loserPlayer?.nationality ? flag(g.loserPlayer.nationality) : '')}${playerBtn(g.loserPlayer)}</span>
          </span></td>
          <td><span class="nongshim-detail-result">${stoneHtml(g.color)}<span>${esc(colorPrefix + g.conciseResult)}</span>${movesHtml}</span></td>
          <td class="nongshim-detail-kifu">${kifuHtml}</td>
        </tr>`);
      }
    }
    return `<section class="nongshim-section" aria-labelledby="nongshimDetailTitle">
      <div class="nongshim-sec-head"><h3 id="nongshimDetailTitle">逐局明细</h3></div>
      <div class="team-table-scroll nongshim-detail-card">
        <table class="nongshim-detail">
          <caption class="sr-only">擂台赛逐局明细</caption>
          <thead><tr><th scope="col">局次</th><th scope="col">日期</th><th scope="col">对局</th><th scope="col">结果</th><th scope="col">棋谱</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    </section>`;
  }

  function renderNongshimBracket({data, block, state, flag, showPlayer, showMatch, rerender}) {
    const model = nongshimModel(data);
    const rankLabels = {1: '冠军', 2: '亚军', 3: '季军'};
    const playerBtn = (player, extraClass = '') => {
      const name = player?.name_zh || '—';
      if (!player?.id) return `<span class="nongshim-player-name ${extraClass}">${esc(name)}</span>`;
      return `<button type="button" class="nongshim-player-btn ${extraClass}" data-player-id="${esc(player.id)}" data-nongshim-player="${esc(player.id)}">${esc(name)}</button>`;
    };

    const layoutControls = [['lanes', '擂台进程图'], ['table', '逐局连胜表'], ['ladder', '阶梯对阵']].map(([key, label]) =>
      `<button type="button" class="btn" data-nongshim-layout="${key}" aria-pressed="${state.layout === key}">${label}</button>`).join('');

    block.classList.add('nongshim-results');
    block.dataset.nongshimLayout = state.layout;

    if (state.layout === 'lanes') {
      block.insertAdjacentHTML('beforeend', `<section class="nongshim-bracket" data-nongshim-layout="lanes">
        ${renderSummary({model, flag, layoutControls})}
        ${renderRosters({model, flag, playerBtn, rankLabels})}
        ${renderLanes({model, flag, selectedGame: state.selectedGame})}
        ${renderDetail({model, flag, playerBtn, selectedGame: state.selectedGame})}
      </section>`);
    } else {
      const teamsHtml = model.teams.map(t => {
        const rankTag = t.team.finish_rank ? rankLabels[t.team.finish_rank] || `第${t.team.finish_rank}名` : '';
        const playersList = t.order.map(stat => {
          const rec = stat.played ? `${stat.wins}胜${stat.losses}负` : '未出场';
          return `<li class="nongshim-roster-item${stat.losses > 0 ? ' is-eliminated' : stat.active ? ' is-active' : !stat.played ? ' is-unplayed' : ''}" data-nongshim-player="${esc(stat.player?.id || '')}">
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
        const decidedGames = model.games.filter(g => g.isDecided);
        const rows = model.games.map((g, idx) => {
          const stage = model.stages.find(st => st.games[0] === g);
          const stageCell = stage ? `<th scope="rowgroup" rowspan="${stage.games.length}" class="nongshim-stage-cell"><strong>${esc(stage.title)}</strong>${stage.dateRange ? `<small>${esc(stage.dateRange)}</small>` : ''}</th>` : '';
          if (!g.isDecided) {
            const p1 = g.player1, p2 = g.player2;
            const resText = g.isNoResult ? '无胜负' : g.isScheduled ? '待赛' : '赛果待补';
            return `<tr data-nongshim-row="${idx}">
              ${stageCell}
              <td class="nongshim-game-num">第${g.tieNumber}局</td>
              <td class="nongshim-game-date">${esc(g.date ? M.dateLabel(g.date) : '—')}</td>
              <td class="nongshim-loser-cell">${p1 ? `<div class="nongshim-cell-player">${p1.nationality ? flag(p1.nationality) : ''}${playerBtn(p1)}</div>` : '—'}</td>
              <td class="nongshim-loser-cell">${p2 ? `<div class="nongshim-cell-player">${p2.nationality ? flag(p2.nationality) : ''}${playerBtn(p2)}</div>` : '—'}</td>
              <td class="nongshim-result-cell">${g.match?.id ? `<button type="button" class="nongshim-result-btn" data-match-id="${esc(g.match.id)}"><span>${esc(resText)}</span></button>` : esc(resText)}</td>
            </tr>`;
          }
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
        void decidedGames;
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
                if (!g.isDecided) {
                  const resLabel = g.isNoResult ? '无胜负' : g.isScheduled ? '待赛' : '赛果待补';
                  return `<td rowspan="${col.spanRows}" class="nongshim-step-cell"${g.match?.id ? ` data-match-id="${esc(g.match.id)}"` : ''}><span class="nongshim-step-meta">${esc(resLabel)}</span></td>`;
                }
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

      const metaParts = [`${model.teams.length} 队`, `${model.games.length} 局`, model.completed ? `${model.stages.length} 阶段` : model.stages.length ? `进行中 · ${model.stages.at(-1).title}` : '进行中'];
      block.insertAdjacentHTML('beforeend', `<section class="nongshim-bracket" data-nongshim-layout="${esc(state.layout)}">
        <header class="nongshim-header">
          <div><h2 class="team-view-title">擂台赛对阵图</h2><p class="nongshim-meta">${esc(metaParts.join(' · '))}</p></div>
          <div class="nongshim-controls team-controls" role="group" aria-label="擂台赛视图样式">${layoutControls}</div>
        </header>
        <div class="nongshim-teams-strip">${teamsHtml}</div>
        <div class="nongshim-stages">${diagramHtml}</div>
      </section>`);
    }

    const bracket = block.querySelector('.nongshim-bracket');
    const byMatchId = new Map(model.games.filter(g => g.match?.id).map(g => [g.match.id, g.match]));
    const setActivePlayer = pid => {
      bracket.querySelectorAll('.is-player-active').forEach(el => el.classList.remove('is-player-active'));
      if (!pid) return;
      const safe = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(pid) : String(pid).replace(/"/g, '\\"');
      bracket.querySelectorAll(`[data-nongshim-player="${safe}"]`).forEach(el => el.classList.add('is-player-active'));
    };
    const selectGame = (gameNum, {scrollToDetail = false} = {}) => {
      const n = Number(gameNum);
      if (!n) return;
      state.selectedGame = n;
      bracket.querySelectorAll('.is-game-selected').forEach(el => el.classList.remove('is-game-selected'));
      bracket.querySelectorAll(`[data-nongshim-game="${n}"]`).forEach(el => el.classList.add('is-game-selected'));
      if (scrollToDetail) {
        const row = bracket.querySelector(`.nongshim-detail-row[data-nongshim-game="${n}"]`);
        row?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
      }
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
      const kifuBtn = event.target.closest('button[data-sgf-match-id]');
      if (kifuBtn && byMatchId.has(kifuBtn.dataset.sgfMatchId)) {
        showMatch?.(byMatchId.get(kifuBtn.dataset.sgfMatchId));
        return;
      }
      if (state.layout === 'lanes') {
        const gameEl = event.target.closest('[data-nongshim-game]');
        if (gameEl) {
          const fromLanes = !gameEl.closest('.nongshim-detail');
          selectGame(gameEl.dataset.nongshimGame, {scrollToDetail: fromLanes});
        }
        return;
      }
      const matchEl = event.target.closest('[data-match-id]');
      if (matchEl && byMatchId.has(matchEl.dataset.matchId)) showMatch?.(byMatchId.get(matchEl.dataset.matchId));
    });
  }

  const FINAL_RANK_LABELS = {1: '冠军', 2: '亚军', 3: '季军'};
  function finalRankText(rank) {
    const value = Number(rank);
    if (!Number.isFinite(value) || value <= 0) return '';
    return FINAL_RANK_LABELS[value] || `第${value}名`;
  }

  /* Team directory: members and their season records grouped by recorded team.
   * Only board assignments count; unassigned games stay outside team totals. */
  function renderTeamDirectory({data, s, flag}) {
    const standingRanks = new Map();
    for (const row of data.team_competition?.standings || []) {
      const after = Number(row.after_round) || 0;
      const previous = standingRanks.get(row.team_id);
      if (!previous || after > previous.after) {
        standingRanks.set(row.team_id, {after, rank: Number(row.rank) || Infinity});
      }
    }
    const finalRank = team => team.finish_rank == null ? Infinity : Number(team.finish_rank) || Infinity;
    const teams = [...s.teams].sort((a, b) => {
      const rankA = finalRank(a), rankB = finalRank(b);
      if (rankA !== rankB) return rankA < rankB ? -1 : 1;
      const standingA = standingRanks.get(a.id)?.rank ?? Infinity, standingB = standingRanks.get(b.id)?.rank ?? Infinity;
      if (standingA !== standingB) return standingA < standingB ? -1 : 1;
      return String(a.name_zh || '').localeCompare(String(b.name_zh || ''), 'zh-CN');
    });
    const cards = teams.map(team => {
      const record = s.teamRecords.get(team.id)
        || {ties: 0, wins: 0, draws: 0, losses: 0, unresolved: 0, boardWins: 0, playerRows: []};
      const rank = Number(team.finish_rank);
      const hasRank = Number.isFinite(rank) && rank > 0;
      const honor = hasRank ? finalRankText(rank) : '';
      const stats = [
        ['场次', record.ties || '—'],
        ['场胜 / 平 / 负', record.ties ? `${record.wins} / ${record.draws} / ${record.losses}` : '—'],
        ['胜局', record.ties ? record.boardWins : '—']
      ];
      const memberRows = team.roster_source === 'games'
        ? record.playerRows.filter(row => row.games > 0) : record.playerRows;
      const rows = memberRows.map(row => {
        const decided = row.wins + row.losses;
        const rate = decided ? `${(100 * row.wins / decided).toFixed(1)}%` : '—';
        const role = row.player.role
          ? `<span class="team-member-role">${esc(row.player.role)}</span>` : '';
        return `<tr><td><button class="team-player" type="button" data-player-id="${esc(row.player.id)}">${esc(row.player.name_zh || '—')}</button>${role}</td><td>${row.games}</td><td>${row.wins}</td><td>${row.losses}</td><td>${row.noResult}</td><td>${row.pending}</td><td>${rate}</td></tr>`;
      }).join('');
      return `<article class="team-card" data-team-id="${esc(team.id)}">
        <header class="team-card-header">
          <div class="team-card-name">${team.region ? `<span class="team-card-flag">${flag(team.region)}</span>` : ''}<h3>${esc(team.name_zh || '—')}</h3></div>
          ${hasRank ? `<div class="team-card-honor"><span>最终名次</span><strong>${esc(honor)}</strong></div>` : ''}
        </header>
        <div class="team-card-record">${stats.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
        <div class="team-table-scroll"><table class="team-roster-table">
          <thead><tr><th scope="col">成员</th><th scope="col">对局</th><th scope="col">胜</th><th scope="col">负</th><th scope="col">无胜负</th><th scope="col">待定</th><th scope="col">胜率</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="team-card-empty">暂无成员资料。</td></tr>'}</tbody>
        </table></div>
        ${record.unresolved ? `<p class="team-card-note">另有 ${record.unresolved} 场未有胜方记录，未计入场胜平负。</p>` : ''}
      </article>`;
    }).join('');
    const notes = [];
    if (s.teams.some(team => team.roster_source === 'games')) notes.push('成员按本届已录出场整理。');
    if (s.loose.length) notes.push(`${s.loose.length} 局未归入团体场次，不计入队伍战绩。`);
    return `<h2 class="team-view-title">队伍总览</h2>${notes.length ? `<p class="team-scope-note">${notes.join('')}</p>` : ''}<div class="team-directory-grid">${cards}</div>`;
  }

  function render(options) {
    const {data, canvas, mode, flag, wikiGame, modernGame, onDraw, showPlayer, showMatch} = options;
    const s = season(data), state = stateFor(data), byTeam = new Map(s.teams.map(t => [t.id, t]));
    const nongshimMode = hasNongshimTies(data);
    // A podium-only team entry (champion/runner-up recorded without ties or a
    // roster) has nothing to group by team, so the directory stays hidden.
    const hasTeamDetail = s.ties.length > 0 || s.teams.some(team => (team.players || []).length > 0);
    if ((!nongshimMode && state.view === 'bracket') || (!s.schedule.length && state.view === 'schedule')
      || (state.view === 'teams' && !hasTeamDetail)) state.view = 'overview';
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
    block.innerHTML = `<nav class="team-nav" aria-label="团体赛视图">${nongshimMode ? button('bracket', '对阵图') : ''}${button('overview', '赛季总览')}${hasTeamDetail ? button('teams', '队伍总览') : ''}${button('round', '逐轮赛果', !s.rounds.length)}${s.schedule.length ? button('schedule', '待赛赛程') : ''}</nav>`;
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
    } else if (state.view === 'teams' && hasTeamDetail) {
      block.insertAdjacentHTML('beforeend', renderTeamDirectory({data, s, flag}));
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
            const useText = typeof document !== 'undefined' && document.body?.dataset?.seriesMarkStyle === 'text';
            const markHtml = (symbol === '○' || symbol === '×')
              ? (useText
                ? `<span class="series-mark-text ${symbol === '○' ? 'is-win' : 'is-loss'}" aria-hidden="true">${symbol === '○' ? '胜' : '负'}</span>`
                : `<svg class="series-mark ${symbol === '○' ? 'series-mark-win' : 'series-mark-loss'}" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${symbol === '○' ? '<path d="M4.5 12.5L9.5 17.5L19.5 6.5" />' : '<path d="M5.5 5.5L18.5 18.5M18.5 5.5L5.5 18.5" />'}</svg>`)
              : symbol;
            return `<span class="series-outcome" data-symbol="${esc(symbol)}" title="${esc(label)}" aria-label="${esc(label)}">${markHtml}</span>`;
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
      if (['bracket', 'overview', 'teams', 'round', 'schedule'].includes(action)) state.view = action;
      else if (action === 'prev' || action === 'next') {state.round = s.rounds[roundIndex + (action === 'next' ? 1 : -1)].id; state.gamePage = 0; state.loose = false;}
      else if (action === 'loose') state.loose = true;
      else if (action.startsWith('player-')) state.playerPage += action.endsWith('next') ? 1 : -1;
      else if (action.startsWith('game-')) state.gamePage += action.endsWith('next') ? 1 : -1;
      rerender();
    });
  }
  const api = {season, nongshimModel, hasNongshimTies, render, revealMatch};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GoViewerTeam = api;
})(typeof window === 'undefined' ? globalThis : window);
