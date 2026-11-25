/* Shared, DOM-free data rules for the local viewer and its regression checks. */
(function (root) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
  const raw = value => ({__html: String(value ?? '')});
  const renderHtmlValue = value => {
    if (value === null || value === undefined || value === false) return '';
    if (Array.isArray(value)) return value.map(renderHtmlValue).join('');
    if (typeof value === 'object' && Object.hasOwn(value, '__html')) return String(value.__html ?? '');
    return escape(value);
  };
  const html = (strings, ...values) => strings.reduce(
    (acc, part, idx) => acc + part + (idx < values.length ? renderHtmlValue(values[idx]) : ''),
    ''
  );
  const samePlayer = (a, b) => !!a && !!b && (a.id && b.id
    ? a.id === b.id : !!a.name_zh && a.name_zh === b.name_zh);
  const participants = m => [m.black_player?.id ? m.black_player : (m.participant_1?.id ? m.participant_1 : {name_zh:m.participant_1_label}),
    m.white_player?.id ? m.white_player : (m.participant_2?.id ? m.participant_2 : {name_zh:m.participant_2_label})];
  function formatRank(value) {
    const rank = String(value ?? '').trim();
    if (/^[业業][余餘]$/.test(rank)) return '';
    const amateur = /^[业業][余餘]\s*(\d+|[一二三四五六七八九])\s*段$/.exec(rank.normalize('NFKC'));
    if (!amateur) return rank;
    const number = amateur[1];
    return `${/^\d+$/.test(number) ? number : '一二三四五六七八九'.indexOf(number) + 1}段`;
  }
  const isWorld = item => (item.category || item.tournament?.category || 'world') === 'world';
  const categoryLabel = item => ({world: '世界大赛', women_world: '女子世界大赛', international: '其他国际比赛', domestic: '国内比赛'})[
    item.category || item.tournament?.category || 'world'] || '其他国际比赛';
  const WORLD_BOUNDARY_TOURNAMENTS = new Set(['world_cmc', 'world_masters', 'bw_t_b947b606eb']);
  const WORLD_TEAM_TOURNAMENTS = new Set(['nongshim', 'jinro', 'sbs_world', 'jinlongcheng_team']);
  const TEAM_TOURNAMENTS = new Set(['cwql', 'cwbl', 'cwcl', 'cwwl', 'cwwbl', 'kb',
    'kr_wleague', 'kr_senior', 'kr_futures', 'kr_challenge', 'kr_ggauction','kr_rookie_league','kr_olleh_giga','kr_queen_team','csk_cup']);
  const isTeamCompetition = (data, meta = {}) => !!data?.team_competition || meta?.competition_type === 'team'
    || data?.competition_type === 'team' || TEAM_TOURNAMENTS.has(data?.tournament?.id || meta?.tournament_id)
    || WORLD_TEAM_TOURNAMENTS.has(data?.tournament?.id || meta?.tournament_id)
    || /团体|團體|团队|擂台|围甲|圍甲/.test(data?.tournament?.name_zh || meta?.tournament_name || '')
    || (data?.rounds || []).some(r => /(?:^|｜)(?:擂台赛|团体赛个人对局)｜/.test(r.round_name || ''));
  const worldTier = (item = {}, data = null) => {
    const tid = item.tournament_id || item.tournamentId || data?.tournament?.id || '';
    if (WORLD_TEAM_TOURNAMENTS.has(tid) || isTeamCompetition(data || item, item)) return 2;
    if (WORLD_BOUNDARY_TOURNAMENTS.has(tid)) return 1;
    return 0;
  };
  const isCoreWorld = (item, data = null) => isWorld(item || {}) && worldTier(item, data) === 0;
  const isStrictEvent = (item = {}, data = null) => {
    const cat = item.category || data?.tournament?.category || 'world';
    if (cat === 'world') return worldTier(item, data) === 0;
    return !isTeamCompetition(data || item, item);
  };
  // Source-verified exceptions whose imported round labels omit the format.
  // Longxing changed to group ladders from edition 8 (Sport.gov.cn c22860930).
  // The inaugural Future Stars used two seven-player leagues (Korea Ki-in 1506).
  const isMixedEliminationDraw = data =>
    (data.tournament?.id === 'longxing_cn' && Number(data.edition?.edition_number) >= 8)
    || data.edition?.id === 'kr_future_01'
    || (data.tournament?.id === 'wangzhongwang' && Number(data.edition?.edition_number) === 1);
  const isRyuseiLadderRound = (data, round) => data.tournament?.id === 'jp_ryusei'
    && /^本戦｜[A-H]组$/.test(round.round_name || '');
  const SINGLE_GAME_FINALS_RE = /^(?:单局|一局|单番棋|单局决胜|一局决胜)$/;
  function isSingleGameFinal(data, meta = {}) {
    if (isTeamCompetition(data, meta)) return false;
    const finalsType = String(data?.edition?.finals_type || '').trim();
    if (finalsType) return SINGLE_GAME_FINALS_RE.test(finalsType);
    const finalRounds = (data?.rounds || [])
      .filter(r => !isPrelimRound(r) && !isUnclassifiedRound(r) && isFinalRound(r));
    const finalGames = finalRounds.flatMap(r => r.matches || []);
    if (finalGames.length > 1) return false;
    const score = String(data?.edition?.finals_score || meta?.finals_score || '').trim();
    const numeric = /^(\d+)\s*[-：:]\s*(\d+)/.exec(score);
    if (numeric) return Number(numeric[1]) + Number(numeric[2]) === 1 && finalGames.length <= 1;
    return finalGames.length === 1;
  }
  function editionFormatChip(data, meta = {}) {
    if (isTeamCompetition(data, meta)) {
      const teams = data.team_competition?.teams || [];
      const regular = (data.team_competition?.standings || []).filter(row => row.phase === 'regular');
      const latest = Math.max(0, ...regular.map(row => row.after_round));
      const year = Number(data.edition?.year);
      const historicalLeagueSize = year === 1999 ? 10 : year >= 2000 && year <= 2016 ? 12
        : year >= 2017 && year <= 2018 ? 14 : year >= 2019 && year <= 2024 ? 16 : null;
      const teamCount = data.tournament?.id === 'cwql'
        ? (teams.length === historicalLeagueSize || regular.filter(row => row.after_round === latest).length === teams.length ? teams.length : 0)
        : teams.length;
      return [teamCount && `${teamCount} 队`, `${editionPlayers(data).filter(p => !isGroupedPlayerLabel(p)).length} 人`,
        data.edition?.finals_type || '团体赛'].filter(Boolean).join(' · ');
    }
    const sizeLabel = data?.edition?.bracket_size ? `${data.edition.bracket_size} 人` : '';
    if (isSingleGameFinal(data, meta)) return sizeLabel;
    return `${sizeLabel || '对阵'} · ${data?.edition?.finals_type || '番棋'}`;
  }
  const isNoResult = m => m.result_method === 'no_result' || m.result_detail === '无胜负' || m.result_type === '无胜负';
  const STATUS_LABELS = {scheduled:'待赛', decided:'有胜负', no_result:'无胜负', pending:'赛果待补'};
  // An explicit status keeps 待赛 and 赛果待补 apart; 无胜负 is never a missing winner.
  const matchStatus = m => isNoResult(m) || m.match_status === 'no_result' ? 'no_result'
    : m.winner?.id || m.winner_id || m.match_status === 'decided' ? 'decided'
    : m.match_status === 'scheduled' ? 'scheduled' : 'pending';
  const statusLabel = m => STATUS_LABELS[matchStatus(m)];
  const hasResult = m => matchStatus(m) !== 'pending' && matchStatus(m) !== 'scheduled';
  const matchResult = m => matchStatus(m) === 'no_result' ? '无胜负'
    : matchStatus(m) === 'scheduled' ? '待赛'
    : matchStatus(m) === 'pending' ? '赛果待补'
    : (m.isSeries || m.series_score) && (!m.result_detail || m.result_detail === '胜' || m.result_detail === `${m.series_score} 胜出`) ? `${m.series_score} 胜出`
    : m.result_detail || m.result_type || '—';
  const winnerLabel = m => !m.winner?.id ? ''
    : (m.isSeries || m.series_score) && (!m.result_detail || m.result_detail === '胜') ? `${m.series_score} 胜出`
    : String(m.result_detail || m.result_type || '胜').replace(/^(?:执)?[黑白](?:方)?/,'') || '胜';
  const editionPlayers = data => (data.roster || collectPlayers({edition:data})).slice().sort((a,b)=>a.name_zh.localeCompare(b.name_zh,'zh-CN'));
  const isGroupedPlayerLabel = player => /^(?:(?:[韩韓中日台]|韩国|中国|日本|外援)\s*\d+[-－—]\d+|台第[一二三四五六七八九十]+位|日大三冠)$/.test(player?.name_zh || '');
  const hasPlayer = (m, p) => participants(m).some(q => samePlayer(q, p));
  function singleGamePresentation(m) {
    // Individual game records can also carry the overall series score. Omit
    // that metadata only from the rendering copy, never from the source record.
    const {isSeries, isFinalSeries, series_score, winner_score, loser_score, player_scores, subgames, ...game} = m;
    if (series_score && /^(?:\d+\s*[-:：]\s*\d+)(?:\s*胜出)?$/.test(String(game.result_detail || '').trim())) {
      game.result_detail = '';
    }
    return game;
  }
  function dateKey(value) {
    const parts = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value || '').trim());
    if (!parts) return null;
    const [, y, mo, d] = parts.map(Number);
    const date = new Date(Date.UTC(y, mo - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
      ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
  }
  function dateLabel(value) {
    return dateKey(value) || String(value || '').trim() || '日期未知';
  }
  // 届次标题的年份：优先取起止日期的年份；起止同年只显示一个年份，跨年显示「起-止」。
  // 日期缺失（只有起日、只有止日或完全未载）时回退到 year 字段，绝不推测未知结束年份。
  function editionYearLabel(edition, fallbackYear) {
    const start = dateKey(edition?.start_date);
    const end = dateKey(edition?.end_date);
    const startYear = start ? Number(start.slice(0, 4)) : null;
    const endYear = end ? Number(end.slice(0, 4)) : null;
    if (startYear && endYear) return startYear === endYear ? `${startYear}` : `${startYear}-${endYear}`;
    const fallback = Number(edition?.year ?? fallbackYear);
    const year = startYear || endYear || (Number.isFinite(fallback) && fallback > 0 ? fallback : null);
    return year ? String(year) : '';
  }
  function editionTitle(edition, meta = {}) {
    const number = edition && Object.hasOwn(edition, 'edition_number') ? edition.edition_number : meta.edition_number;
    const year = editionYearLabel(edition, meta.year);
    return `${number != null ? `第${number}届 ` : ''}${meta.tournament_name || ''}${year ? `（${year}年）` : ''}`;
  }
  function editionLabel(edition = {}) {
    return edition.edition_number != null && edition.edition_number !== ''
      ? `第${edition.edition_number}届` : edition.year ? `${edition.year}年` : '—';
  }
  // 冠军是缺值还是未决必须分开：只有结束日期未到、或无结束日期的当届，才可写“进行中”。
  // 已结束但未录冠军的届次按缺值显示，避免把历史届次标成仍在进行。
  function editionOngoing(item, today) {
    if (!item) return false;
    const current = today || new Date().toISOString().slice(0, 10);
    const rawEnd = String(item.end_date || '').trim();
    const end = dateKey(rawEnd) || (/^\d{4}-\d{2}-\d{2}/.test(rawEnd) ? rawEnd.slice(0, 10) : null);
    if (end) return end >= current;
    const year = Number(item.year);
    return Number.isFinite(year) && year >= Number(current.slice(0, 4));
  }
  function editionChampionText(item, today) {
    if (item && item.champion) return item.champion;
    return editionOngoing(item, today) ? '进行中 · 冠军待定' : '—';
  }
  function isMainOngoing(item, allData, today = new Date().toISOString().slice(0, 10)) {
    if (!item || item.champion || item.champion_id || !editionOngoing(item, today)) return false;
    const start = dateKey(item.start_date);
    if (start ? start > today : Number(item.year) > Number(today.slice(0, 4))) return false;
    if (typeof item.has_main_stage === 'boolean') return item.has_main_stage;
    const data = allData?.[item.id];
    if (!data) return false;
    const ties = data.team_competition?.ties || [];
    return Boolean(data.league_rankings?.length) || (data.rounds || []).some(round =>
      round.round_name?.trim() && !isPrelimRound(round) && !isUnclassifiedRound(round) &&
      (/^本赛\s*[｜|]/.test(round.round_name.trim()) || !/初赛|复赛|资格/.test(round.round_name)) &&
      (round.matches?.length || ties.some(tie => tie.round_id === round.id)));
  }
  // 预选/复赛/资格赛等前置阶段在正赛前数月举行属正常口径，不按届次日期判冲突。
  const PRELIM_ROUND_NAME = /预选|予選|预赛|复赛|资格|本选/;
  function isPrelimRoundName(name) { return PRELIM_ROUND_NAME.test(String(name || '')); }
  function prelimRoundIds(edition) {
    const ids = new Set();
    for (const round of edition?.rounds || []) if (isPrelimRoundName(round.round_name)) ids.add(round.id);
    return ids;
  }
  function dateConflict(m, edition, prelimIds) {
    if (/_pq_/.test(m.round_id || '') || /_pq_/.test(m.id || '')) return false;
    if (prelimIds && prelimIds.has(m.round_id)) return false;
    const d = dateKey(m.date), start = dateKey(edition.start_date), end = dateKey(edition.end_date);
    return !!d && ((start && d < start) || (end && d > end));
  }
  // 详情视图直接给“届次对象”（含 rounds）时用这个包装，自动带上预选轮次集合。
  function dateConflictInEdition(m, edition, prelimIds) {
    const view = edition?.edition ? edition : null;
    const core = view ? view.edition : edition;
    return dateConflict(m, core, prelimIds || (view ? prelimRoundIds(view) : null));
  }
  function aggregateSeries(round, finalId) {
    const matches = round?.matches || [];
    if (matches.length <= 2) {
      if (matches.some(m => m.series_score)) {
        return [...matches].map(m => {
          if (!m.series_score) return m;
          const numeric = /^(\d+)-(\d+)$/.exec(m.series_score || '');
          const winnerScore = numeric ? numeric[1] : '—';
          const loserScore = numeric ? numeric[2] : '—';
          return {
            ...m,
            isSeries: true,
            winner_score: winnerScore,
            loser_score: loserScore,
            result_detail: numeric ? `${m.series_score} 胜出` : (m.result_detail || `${m.series_score} 胜出`),
            tooltip: m.tooltip || `${/挑战者决定战|挑戦者決定戦/.test(round?.round_name || '') ? '挑战者决定战' : '半决赛番棋'} (${m.series_score})${m.result_note ? ' · ' + m.result_note : ''}`
          };
        });
      }
      if (matches.length < 2) return matches;
    }
    const pairs = new Map();
    for (const m of matches) {
      const [a, b] = participants(m);
      if (!a.id || !b.id) return matches;
      const key = [a.id, b.id].sort().join('|');
      if (!pairs.has(key)) pairs.set(key, {a, b, games: []});
      pairs.get(key).games.push(m);
    }
    // A partial semifinal can have just one pair. Two ordinary single games
    // remain separate; unrelated multi-pair rounds must never be collapsed.
    if (pairs.size > 2 || ![...pairs.values()].some(p => p.games.length > 1)) return matches;
    return [...pairs.values()].map((pair, i) => {
      if (pair.games.length === 1) return pair.games[0];
      const games = pair.games.slice().sort((a, b) =>
        (dateKey(a.date) || '').localeCompare(dateKey(b.date) || '') || a.match_number - b.match_number);
      const aWins = games.filter(g => samePlayer(g.winner, pair.a)).length;
      const bWins = games.filter(g => samePlayer(g.winner, pair.b)).length;
      const declared = round.series_winner_id || games.find(g => g.series_winner_id)?.series_winner_id;
      const declaredWinner = [pair.a, pair.b].find(p => p.id === declared);
      const complete = aWins + bWins === games.length && aWins !== bWins;
      const winner = declaredWinner || (complete ? (aWins > bWins ? pair.a : pair.b) : {});
      const subgames = effectiveSeriesGames(games, winner);
      const first = samePlayer(winner, pair.b) ? pair.b : pair.a;
      const second = samePlayer(first, pair.a) ? pair.b : pair.a;
      const declaredScore = round.series_score || games.find(g => g.series_score)?.series_score;
      const calculatedScore = complete ? `${Math.max(aWins, bWins)}-${Math.min(aWins, bWins)}` : '赛果待核';
      const score = declaredScore || calculatedScore;
      const numeric = /^(\d+)-(\d+)$/.exec(score);
      // 挑战者决定战与半决赛都用番棋聚合，但编号和提示不能混用。
      const decider = /挑战者决定战|挑战者決定戰|挑戦者決定戦|冠军决定战|冠軍決定戰/.test(round?.round_name || '');
      const drawOrder = games.map(g => g?.draw_order).find(v => Number.isInteger(Number(v)) && Number(v) > 0) ?? null;
      return {
        id: `${round.id}_series_${i + 1}`, bracket_code: `${decider ? 'CF' : 'SF'}-${i + 1}`, isSeries: true,
        draw_order: drawOrder, match_number: games[0]?.match_number ?? null,
        black_player: first, white_player: second, winner,
        winner_score: numeric ? numeric[1] : '—', loser_score: numeric ? numeric[2] : '—',
        series_score: score, result_detail: numeric ? `${score} 胜出` : score,
        player_scores: numeric && winner.id ? [numeric[1], numeric[2]] : [
          games.filter(g => samePlayer(g.winner, first) && !isNoResult(g)).length,
          games.filter(g => samePlayer(g.winner, second) && !isNoResult(g)).length],
        date: subgames[0].date === subgames.at(-1).date ? dateLabel(subgames[0].date)
          : `${dateLabel(subgames[0].date)} ～ ${dateLabel(subgames.at(-1).date)}`,
        next_match_id: winner.id ? finalId : '', subgames,
        tooltip: `${decider ? '挑战者决定战' : '半决赛番棋'} (${score})${round?.series_advantage_note ? ' · ' + round.series_advantage_note : ''}${round?.date_range ? ' · ' + round.date_range : ''}\n` +
          subgames.map((g, k) => `第${k + 1}局 (${dateLabel(g.date)}): ${g.winner?.name_zh || '胜者待定'} · ${g.result_detail || g.result_type || '—'}`).join('\n')
      };
    });
  }
  // 番棋已决出胜者时，尚未进行且不改写已定赛果的赛程占位局（scheduled）不再显示为待赛/省略号。
  function effectiveSeriesGames(games, winner) {
    const list = games || [];
    if (!winner?.id || !list.some(g => matchStatus(g) !== 'scheduled')) return list;
    return list.filter(g => matchStatus(g) !== 'scheduled');
  }
  // Presentation-only summary. Keep the original games (and their result status)
  // intact; an edition's declared score may also contain preserved annotations.
  function finalSeries(round, data) {
    const games = round.matches || [];
    if (!games.length) return null;
    if (games.length === 1) return games[0];
    const [a, b] = participants(games[0]);
    if (!a.id || !b.id || !games.every(g => {
      const ids = participants(g).map(p => p.id);
      return ids.includes(a.id) && ids.includes(b.id);
    })) return null;
    const ordered = games.slice().sort((x, y) =>
      (dateKey(x.date) || '').localeCompare(dateKey(y.date) || '') || (x.match_number || 0) - (y.match_number || 0));
    const declared = games.find(g => g.series_winner_id)?.series_winner_id;
    const winner = [a, b].find(p => p.id === (declared || data.champion?.id)) || {};
    const subgames = effectiveSeriesGames(ordered, winner);
    const first = samePlayer(winner, b) ? b : a, second = samePlayer(first, a) ? b : a;
    const wins = p => games.filter(g => !isNoResult(g) && samePlayer(g.winner, p)).length;
    const score = data.edition?.finals_score || games.find(g => g.series_score)?.series_score || `${wins(first)}-${wins(second)}`;
    const numeric = /^(\d+)\s*[-：:]\s*(\d+)/.exec(score);
    return {id: games[0].id, round_id: round.id, bracket_code: 'FINAL', isSeries: true, isFinalSeries: true,
      participant_1: first, participant_2: second, winner, series_score: score,
      player_scores: numeric && winner.id ? [numeric[1], numeric[2]] : [wins(first), wins(second)],
      date: round.date_range || subgames[0].date, subgames,
      result_detail: winner.id ? `${score} 胜出` : score};
  }
  function seriesOutcomes(m) {
    const first = participants(m)[0];
    const winner = m?.winner?.id ? m.winner : (m?.series_winner_id ? {id: m.series_winner_id} : null);
    return effectiveSeriesGames(m?.subgames, winner).map((g, i) => {
      const status = matchStatus(g);
      const won = samePlayer(g.winner, first);
      const known = participants(g).some(p => samePlayer(p, first)) && participants(g).some(p => samePlayer(p, g.winner));
      const label = status === 'no_result' ? '无胜负' : status === 'scheduled' ? '待赛'
        : status === 'decided' && known ? (won ? '胜' : '负') : '赛果待补';
      const symbol = status === 'no_result' ? '—' : status === 'scheduled' ? '…'
        : status === 'decided' && known ? (won ? '○' : '×') : '?';
      const dateStr = dateKey(g.date);
      const dateNote = dateStr ? ` (${dateStr})` : '';
      return {symbol, date: dateStr, label: `第${i + 1}局${dateNote}：${first.name_zh || '先列棋手'}${label}`, game: g};
    });
  }
  // 导入的对局把来源编号写进 bracket_code（SRC-<来源编号>）用于溯源，它不是给人看的编排名；
  // 决赛逐局卡片按顺序显示“第N局”（与手工补录的“第7局”一致），其余编号原样保留。
  const INTERNAL_BRACKET_CODE = /^SRC-/i;
  function seriesGameLabel(game, index) {
    const code = String(game?.bracket_code || '').trim();
    return !code || INTERNAL_BRACKET_CODE.test(code) ? `第${index + 1}局` : code;
  }
  const PRELIM_STAGE_PREFIX = /^预选(?:赛)?(?:[\/／]复赛)?[｜|]/;
  function roundDisplayName(round) {
    const name = String(round.round_name || '').trim()
      .replace(LEAGUE_STAGE_PREFIX, '')
      .replace(/^本赛\s*[｜|]\s*/, '')
      // 届次已由页头给出；“本赛8强/本赛4强/本赛挑战者决定战”只保留阶段名。
      .replace(/^本赛(?=(?:\d+强|半决赛|决赛|挑战))/, '');
    // The edition page already names the competition. Keep the round and any
    // group/game qualifier; leave unfamiliar source labels intact.
    return name.replace(/^第[\d一二三四五六七八九十百]+届.+?(?:杯|赛|战)(?=(?:(?:[男女]子|小|胜者|败者|[A-Z])组)?(?:(?:\d+|[一二三四五六七八九十百]+)强|半决赛|决赛)(?:第[\d一二三四五六七八九十/]+局)?$)/, '')
      .replace(/本戦(?:トーナメント)?/g,'本赛').replace(/準々決勝/g,'8强').replace(/準決勝/g,'半决赛')
      .replace(/決勝/g,'决赛').replace(/(\d+)回戦/g,'第$1轮');
  }
  // 补录对局把来源的原始轮次写在备注里。若整个赛段的每一局都来自预选、初赛、
  // 复赛或资格赛，赛段篮子的名称（如“决赛”“第1轮”）不能把它算进本赛晋级图。
  // 待核赛段仍按待核处理，不因备注改判。
  const PRELIM_ORIGIN = /原轮次[：:]\s*[^；\n]*(?:预选|预赛|初赛|复赛|予選|예선|资格)/;
  const PENDING_ROUND_NAME = /^(?:赛果记录|赛段待核|弘通补录|补录|赛段未载|来源未记?载赛段)/;
  // 置于待核的赛段若名称本身写明「初赛/复赛/资格赛」，它仍是预选赛段；
  // 只按名称归类，不进本赛晋级图（位置待核的对局不因改名而冒充本赛）。
  const PARKED_PRELIM_NAME = /^赛段待核\s*[｜|]\s*.*(?:初赛|预选|预赛|复赛|资格赛|予選)/;
  function isPrelimRound(round) {
    // CWI uses *_pq_* IDs; domestic imports carry an explicit stage prefix.
    // Do not classify by a word anywhere in the title (e.g. 正赛资格赛).
    const name = String(round.round_name || '').trim();
    if (/_pq_/.test(round.id || '') || PRELIM_STAGE_PREFIX.test(name) || PARKED_PRELIM_NAME.test(name)) return true;
    if (/^本赛\s*[｜|]/.test(name)) return false;
    if (/预选|预赛|本选|予選|예선|선발전|选拔|ファースト/.test(name.replace(/\s+/g,''))) return true;
    const matches = round.matches || [];
    return matches.length > 0 && !PENDING_ROUND_NAME.test(name)
      && matches.every(m => PRELIM_ORIGIN.test(String(m.notes || '')));
  }
  const isUnclassifiedRound = round => !isPrelimRound(round) && (
    /^(?:赛果记录|赛段待核|弘通补录|补录|赛段未载|来源未记?载赛段)(?:[｜|]|$)/.test(String(round.round_name || '').trim())
    || /^(?:本赛|本戦)[｜|]\d{4}-\d{1,2}-\d{1,2}$/.test(String(round.round_name || '').trim()));
  // 「循环赛｜」是部分韩国赛事沿用的赛段前缀：它也可能出现在本赛淘汰、
  // 挑战者决定战和头衔战之前，不能单凭前缀把整届都当成循环圈。
  const LEAGUE_STAGE_PREFIX = /^循环赛\s*[｜|]\s*/;
  const GROUP_TABLE_NAME = /^(?:\d+强)?[A-H]组(?:\d+[场局轮])?$/;
  const KNOCKOUT_CORE = /^(?:本赛|本戦|本賽)?(?:\d+强|半决赛|準決勝|决赛|決勝)|挑战|挑戰|挑戦|决定战|決定戰|決定戦|番棋|淘汰/;
  const leagueCoreName = round => String(round?.round_name || '').trim().replace(LEAGUE_STAGE_PREFIX, '');
  // 16强A组这类分组赛与循环圈一样按表格呈现；「本赛8强」等淘汰阶段仍走连线。
  const isGroupTableRound = round => GROUP_TABLE_NAME.test(leagueCoreName(round));
  const isLeagueRound = round => {
    const name = String(round?.round_name || '');
    const core = leagueCoreName(round);
    if (isGroupTableRound(round)) return true;
    if (/→|->|加赛|加賽|プレーオフ|勝者|胜者|败者|敗者|決定戦|决定战|决定赛|決定賽/.test(core)) return false;
    if (/循环|循環|リーグ|积分编排/.test(core)) return true;
    return LEAGUE_STAGE_PREFIX.test(name) && !KNOCKOUT_CORE.test(core);
  };
  const isVagueRound = round => /^(?:本赛|本戦|赛果记录)[｜|]\d{4}-/.test(round?.round_name || '');
  const PRELIM_REGION_ORDER = ['中国', '日本', '韩国', '中国台湾', '综合预选', '预选/复赛', '其他地区'];
  // 台湾棋战的赛段名常混用繁简（「挑戰赛」= 繁「戰」+ 简「赛」），
  // 只在判定头衔赛/决赛时归一到同一写法，避免整段被当普通淘汰轮。
  const FINAL_NAME_VARIANTS = {戰: '战', 賽: '赛'};
  const finalNameVariants = name => String(name || '').replace(/[戰賽]/g, ch => FINAL_NAME_VARIANTS[ch]);
  function isFinalRound(round) {
    const name = finalNameVariants(String(round.round_name || '')
      .replace(LEAGUE_STAGE_PREFIX, '')
      .replace(/^(?:本戦)?決勝トーナメント[｜|]/, ''));
    return /决赛|決賽|決勝|挑战赛|挑戦手合|挑战\s*\d+\s*番棋|三番战|五番战|七番战/.test(name) && !/半|準|季|三四|小组|循环|循環|胜者|败者|勝者|敗者|胜部|败部|勝部|敗部|挑战者|挑戰者|挑戦者/.test(name);
  }
  function combineFinalSeriesRounds(rounds) {
    const groups = new Map();
    for (const round of rounds) {
      if (!isFinalRound(round) || !round.matches.length) continue;
      const ids = participants(round.matches[0]).map(p => p.id).sort();
      if (!ids.every(Boolean) || !round.matches.every(m => participants(m).map(p => p.id).sort().join('|') === ids.join('|'))) continue;
      const key = ids.join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(round);
    }
    const replacements = new Map(), omitted = new Set();
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const matches = group.flatMap(r => r.matches).sort((a, b) =>
        (dateKey(a.date) || '').localeCompare(dateKey(b.date) || '') || (a.match_number || 0) - (b.match_number || 0));
      const dates = matches.map(m => dateKey(m.date)).filter(Boolean);
      replacements.set(group[0], {...group[0], round_name: '决赛', matches,
        date_range: dates.length ? (dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} ～ ${dates.at(-1)}`) : group[0].date_range});
      group.slice(1).forEach(r => omitted.add(r));
    }
    return rounds.filter(r => !omitted.has(r)).map(r => replacements.get(r) || r);
  }
  // 挑战者决定战常被逐局导入为多个赛段（第1局、第2局……）。同名的单一番棋
  // 合回一个赛段后，才能以系列对局节点参与晋级连线；不同对手的同名轮次不合并。
  const SERIES_LEG_NAME = /^(.*?)(?:第\s*([0-9]+)\s*局)(?:\s*[（(][^）)]*[）)])?\s*$/;
  const SERIES_STAGE_NAME = /挑战者决定战|挑战者決定戰|冠军决定战|冠軍決定戰/;
  function combineSeriesLegs(rounds) {
    const groups = new Map();
    for (const round of rounds) {
      const name = leagueCoreName(round);
      const hit = SERIES_LEG_NAME.exec(name);
      if (!hit || !SERIES_STAGE_NAME.test(hit[1])) continue;
      const matches = round.matches || [];
      if (!matches.length) continue;
      const ids = matches.flatMap(m => participants(m).map(p => p.id));
      if (!ids.every(Boolean) || new Set(ids).size !== 2) continue;
      const key = hit[1] + '|' + [...new Set(ids)].sort().join('|');
      if (!groups.has(key)) groups.set(key, {base: hit[1], rounds: []});
      groups.get(key).rounds.push(round);
    }
    const replacements = new Map(), omitted = new Set();
    for (const {base, rounds: legs} of groups.values()) {
      if (legs.length < 2) continue;
      const matches = legs.flatMap(r => r.matches).sort((a, b) =>
        (dateKey(a.date) || '').localeCompare(dateKey(b.date) || '') || (a.match_number || 0) - (b.match_number || 0));
      const dates = matches.map(m => dateKey(m.date)).filter(Boolean);
      replacements.set(legs[0], {...legs[0], round_name: base, matches,
        date_range: dates.length ? (dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} ～ ${dates.at(-1)}`) : legs[0].date_range,
        source_rounds: legs});
      legs.slice(1).forEach(r => omitted.add(r));
    }
    return rounds.filter(r => !omitted.has(r)).map(r => replacements.get(r) || r);
  }
  // 台湾头衔战的番棋有时只以「第1局、第2局……」命名，赛段名里没有「决赛」。
  // 末尾连续、每段只有一局、且始终是同一对棋手的几段，就是头衔番棋；
  // 只合并末尾这一段，缺局或对手变动的资料保持原样。
  function combineTrailingTitleSeries(rounds) {
    if (rounds.length < 2) return rounds;
    // 只在本届还没有决赛赛段时兜底；已有决赛时，末尾单局段多半属于半决赛
    // 番棋的其余局，不能当作又一个决赛。
    if (rounds.some(round => isFinalRound(round))) return rounds;
    let start = rounds.length, pair = null;
    for (let index = rounds.length - 1; index >= 0; index--) {
      const games = rounds[index].matches || [];
      if (games.length !== 1) break;
      const ids = participants(games[0]).map(player => player.id).filter(Boolean);
      if (ids.length !== 2) break;
      const key = [...ids].sort().join('|');
      if (pair !== null && key !== pair) break;
      pair = key;
      start = index;
    }
    if (rounds.length - start < 2) return rounds;
    const legs = rounds.slice(start);
    if (legs.some(round => round.source_rounds)) return rounds;
    const matches = legs.flatMap(round => round.matches).sort((a, b) =>
      (dateKey(a.date) || '').localeCompare(dateKey(b.date) || '') || (a.match_number || 0) - (b.match_number || 0));
    const dates = matches.map(match => dateKey(match.date)).filter(Boolean);
    const merged = {...legs[0], round_name: '决赛', matches, source_rounds: legs,
      date_range: dates.length ? (dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} ～ ${dates.at(-1)}`) : legs[0].date_range};
    return [...rounds.slice(0, start), merged];
  }
  // 半决赛等番棋也会被逐局导入为多个赛段（“4强3番勝負第1局、第2局……”）。基础
  // 赛段名相同、同一对棋手再次交手时合回一个赛段，才能在淘汰图里只占一层。
  // 只在它是决赛前最后一层时合并：更早的番棋赛段仍按逐局记录陈列，避免把
  // 尚未接入决赛的轮次强行并成一层。决赛逐局由 combineFinalSeriesRounds 归并。
  const SERIES_LEG_STAGE = /^(.*?)(?:第\s*[0-9]+\s*局)(?:\s*[（(][^）)]*[）)])?\s*$/;
  const SERIES_LEG_SKIP = /循环|循環|リーグ|双败|雙敗|组|組|擂台|团体|團體/;
  function combineSeriesLegStages(rounds) {
    const replacements = new Map(), omitted = new Set();
    const baseOf = round => {
      if (isFinalRound(round)) return null;
      const hit = SERIES_LEG_STAGE.exec(leagueCoreName(round));
      if (!hit) return null;
      const base = hit[1].trim().replace(/[｜|]\s*$/, '');
      return !base || SERIES_LEG_SKIP.test(base) ? null : base;
    };
    const pairOf = m => {
      const ids = participants(m).map(p => p.id);
      return ids.every(Boolean) ? ids.slice().sort().join('|') : null;
    };
    // 决赛逐局已合成一段；只有「本段之后只剩这一段决赛」才是晋级图的半决赛层。
    const penultimateBefore = index => {
      const later = rounds.slice(index).filter(r => r.matches.length);
      return later.length === 1 && isFinalRound(later[0]);
    };
    let index = 0;
    while (index < rounds.length) {
      const base = baseOf(rounds[index]);
      if (!base) {index += 1; continue;}
      const legs = [rounds[index]];
      let next = index + 1;
      while (next < rounds.length && baseOf(rounds[next]) === base) {legs.push(rounds[next]); next += 1;}
      const ids = new Set(), pairs = new Map();
      let usable = legs.length > 1;
      for (const round of legs) {
        if (!round.matches.length) {usable = false; break;}
        for (const m of round.matches) {
          const key = pairOf(m);
          if (!key) {usable = false; break;}
          key.split('|').forEach(id => ids.add(id));
          pairs.set(key, (pairs.get(key) || 0) + 1);
        }
        if (!usable) break;
      }
      // 只合并一对一局或两对同时进行的番棋；同一对棋手至少再次交手一次，
      // 才说明这些赛段是同一番棋的逐局，而不是按局号顺序导入的普通轮次。
      if (usable && penultimateBefore(next) && (ids.size === 2 || ids.size === 4) &&
          [...pairs.values()].some(n => n > 1)) {
        const matches = legs.flatMap(r => r.matches).sort((a, b) =>
          (dateKey(a.date) || '').localeCompare(dateKey(b.date) || '') || (a.match_number || 0) - (b.match_number || 0));
        const dates = matches.map(m => dateKey(m.date)).filter(Boolean);
        replacements.set(legs[0], {...legs[0], round_name: base, matches, source_rounds: legs,
          date_range: dates.length ? (dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} ～ ${dates.at(-1)}`) : legs[0].date_range});
        legs.slice(1).forEach(r => omitted.add(r));
      }
      index = next;
    }
    const merged = rounds.filter(r => !omitted.has(r)).map(r => replacements.get(r) || r);
    if (!replacements.size) return merged;
    // 合并番棋后，末尾没有对局的赛段不再占晋级图末端位置：否则半决赛锚点会
    // 落到决赛之后，前面几层反而被判为未接入。
    let end = merged.length;
    while (end > 1 && !merged[end - 1].matches.length) end -= 1;
    return merged.slice(0, end);
  }
  // 同一小组的补赛、加赛若被导入成独立赛段（如“16强D组”与“16强D组3场”），
  // 合回该组一个赛段，组表与轮次统计才不会把一场补赛当成新阶段。
  function combineGroupRounds(rounds) {
    const groups = new Map();
    for (const round of rounds) {
      if (!isGroupTableRound(round)) continue;
      const label = leagueCoreName(round).replace(/\d+\s*[场局]$/, '');
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(round);
    }
    const replacements = new Map(), omitted = new Set();
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const matches = group.flatMap(r => r.matches).sort((a, b) =>
        (dateKey(a.date) || '').localeCompare(dateKey(b.date) || '') || (a.match_number || 0) - (b.match_number || 0));
      const dates = matches.map(m => dateKey(m.date)).filter(Boolean);
      replacements.set(group[0], {...group[0], matches,
        date_range: dates.length ? (dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} ～ ${dates.at(-1)}`) : group[0].date_range,
        source_rounds: group});
      group.slice(1).forEach(r => omitted.add(r));
    }
    return rounds.filter(r => !omitted.has(r)).map(r => replacements.get(r) || r);
  }
  // Parallel source tables are often ordered by date of publication. Draw
  // columns follow their explicit competition stage, retaining every source ID.
  function organizeParallelRounds(rounds, data) {
    const tid = data.tournament?.id;
    const korean = /^kr_/.test(tid || '');
    const letterGroups=[...new Set(rounds.filter(r=>/本赛[A-H]组第1轮/.test(r.round_name || ''))
      .map(r=>/本赛([A-H])组/.exec(r.round_name)[1]))];
    const letterSize=letterGroups.length && rounds.some(r=>/本赛[A-H]组(?:胜者|败者)第2轮/.test(r.round_name || ''))
      ? letterGroups.length*4 : 0;
    const descriptors = new Map();
    for (const r of rounds) {
      const name = r.round_name || '';
      if (tid === 'jp_k_open') {
        const hit = /^(?:本赛[｜|])?(トップクラス|[A-D]クラス)[｜|](1回戦|準決勝|決勝)$/.exec(name);
        if (hit) descriptors.set(r, {key:hit[2], order:['1回戦','準決勝','決勝'].indexOf(hit[2]),
          label:'各级别 · '+({'1回戦':'8强','準決勝':'半决赛','決勝':'决赛'}[hit[2]]), group:hit[1]});
      } else if (korean && !isFinalRound(r) && !isLeagueRound(r)) {
        const size = Number(/(\d+)强/.exec(name)?.[1] ||
          (tid === 'kr_ryongseong' && /本赛\d+组/.test(name) ? 32 : /本赛[A-H]组/.test(name) ? letterSize : 0));
        const group = /([A-H]|\d+)组/.exec(name)?.[1] || (size === 4 ? '1' : '');
        const stageHasDouble = size && (size===letterSize || rounds.some(q => new RegExp(size+'强').test(q.round_name || '') && /胜者|败者|败部|最终/.test(q.round_name || '')));
        if (!size || !group || !stageHasDouble) continue;
        const branch = /败部复活|最终|第3轮|3라운드/.test(name) ? 'qualify'
          : /败者/.test(name) ? 'loser' : /胜者/.test(name) ? 'winner' : 'first';
        const step = branch === 'first' ? 1 : branch === 'qualify' ? 3 : 2;
        descriptors.set(r, {key:`${size}-${step}`, order:(32-size)*10+step,
          label:`${size}强小组双败 · ${['首轮','胜者战 / 败者战','出线战'][step-1]}`,
          group, size, step, branch});
      }
    }
    if (!descriptors.size) return rounds;
    const grouped = new Map();
    for (const [r, d] of descriptors) {
      if (!grouped.has(d.key)) grouped.set(d.key, {descriptor:d, sources:[]});
      grouped.get(d.key).sources.push(r);
    }
    const merged = [...grouped.values()].sort((a,b)=>a.descriptor.order-b.descriptor.order).map(({descriptor:d,sources})=>{
      const dates = sources.flatMap(r=>r.matches.map(m=>dateKey(m.date))).filter(Boolean).sort();
      return {...sources[0], id:`draw_${tid}_${d.key}`, source_rounds:sources, round_name:d.label,
        round_order:d.order, date_range:dates.length ? `${dates[0]} ～ ${dates.at(-1)}` : '',
        matches:sources.flatMap(r=>{
          const info=descriptors.get(r);
          return r.matches.map(m=>({...m,draw_group:tid==='jp_k_open' ? info.group : `${info.group}组`,
            draw_stage:korean ? {size:info.size,step:info.step,branch:info.branch,group:info.group} : undefined}));
        }).sort((a,b)=>String(a.draw_group).localeCompare(String(b.draw_group),'zh-CN',{numeric:true}) || (a.match_number||0)-(b.match_number||0))};
    });
    // A later knockout stage must follow all group stages of the larger field,
    // including groups whose broadcasts were delayed beyond the round of 16.
    const rest = rounds.filter(r=>!descriptors.has(r));
    if (korean) {
      const key = r => {
        const d = r.matches[0]?.draw_stage;
        if (d) return (32-d.size)*10+d.step;
        const size=Number(/(\d+)强/.exec(r.round_name || '')?.[1]);
        return size ? (32-size)*10+1 : isFinalRound(r) ? 1000 : 900;
      };
      return [...merged,...rest].sort((a,b)=>key(a)-key(b));
    }
    return [...merged,...rest];
  }
  function combineKnockoutAliases(rounds, data) {
    if ((data.tournament?.category || data.category) !== 'domestic') return rounds;
    const describe = r => {
      let name=String(r.round_name || '').replace(/\s+/g,'').replace(/^(?:本赛|本賽|本戦)[｜|]?/,'')
        .replace(/^第\d+(?:期|届).+?(?:战|赛)(?=\d+强)/,'');
      // Finals legs are one terminal stage even before their later aggregation.
      // Their 番/第N局 suffix must not prevent sorting the preceding knockout.
      if (isFinalRound(r)) return {key:'F',order:11000,label:'决赛'};
      if (r.source_rounds || isLeagueRound(r) || /组|組|胜者|败者|败部|라운드|循環|循环|初赛|番|第\d+局/.test(name)) return null;
      if (/^(?:半决赛|準決勝|4强전?)$/.test(name)) return {key:'SF',order:9996,label:'半决赛'};
      if (/挑战者决定战/.test(name)) return {key:'CF',order:10500,label:'挑战者决定战'};
      const size=/(\d+)强/.exec(name);
      if (size) {
        const division=name.slice(0,size.index).replace(/第\d+轮[（(]?/,'');
        if (!/^(?:전|決定|决定|[）)]|补赛|補賽)*$/.test(name.slice(size.index+size[0].length))) return null;
        return {key:'R'+size[1],order:10000-Number(size[1]),label:size[1]+'强',division};
      }
      const num=/^第(\d+)[轮輪](?:上半[区區]|下半[区區])?(?:补赛|補賽)?$/.exec(name);
      return num ? {key:'N'+num[1],order:9000+Number(num[1]),label:'第'+num[1]+'轮'} : null;
    };
    const groups=new Map();
    rounds.forEach(r=>{const d=describe(r);if(d){if(!groups.has(d.key))groups.set(d.key,{d,rs:[]});groups.get(d.key).rs.push(r);}});
    const replace=new Map(), omitted=new Set(), mergedOrders=new Map();
    for(const {d,rs} of groups.values()) {
      if(rs.length<2 || d.key==='F') continue;
      // Repeated players indicate a series, replay, duplicate or unclear source;
      // keep those records separate for review instead of merging blindly.
      const ids=rs.flatMap(r=>r.matches.flatMap(m=>participants(m).map(p=>p.id).filter(Boolean)));
      if(new Set(ids).size!==ids.length) continue;
      const merged={...rs[0],source_rounds:rs,round_name:d.label,matches:rs.flatMap(r=>r.matches.map(m=>
        describe(r)?.division ? {...m,draw_group:describe(r).division} : m))};
      replace.set(rs[0],merged);mergedOrders.set(merged,d.order);
      rs.slice(1).forEach(r=>omitted.add(r));
    }
    const result=rounds.filter(r=>!omitted.has(r)).map(r=>replace.get(r)||r);
    const orderOf=r=>describe(r)?.order ?? mergedOrders.get(r);
    if(result.every(r=>orderOf(r)!=null)) result.sort((a,b)=>orderOf(a)-orderOf(b));
    return result;
  }
  const isLoserRound = r => /败者|敗者|败部|敗部/.test(r.round_name || '');
  // Classify display nodes, including group stages where winners and losers
  // share a column. Unknown later stages converge without inventing a branch.
  function doubleEliminationLanes(rounds, edges) {
    const winnerName = /胜者(?:组|組)?|勝者(?:组|組)?|胜部|勝部/;
    const loserName = /败者(?:组|組|战|戰)?|敗者(?:组|組|战|戰)?|败部|敗部|败者复活|敗者復活/;
    const grouped = rounds.some(r => /双败|雙敗/.test(r.round_name || '') || (r.matches || []).some(m => m.draw_stage || /^GRP-[A-H]-[1-5]$/.test(m.bracket_code || '')));
    const named = rounds.some(r => loserName.test(r.round_name || '')) && rounds.some(r =>
      winnerName.test(r.round_name || '') || (/本戦|本赛|本賽/.test(r.round_name || '') && !loserName.test(r.round_name || '')));
    if (!grouped && !named) return null;
    const firstBranch = rounds.findIndex(r => winnerName.test(r.round_name || '') || loserName.test(r.round_name || ''));
    const lastLoser = rounds.map(r => loserName.test(r.round_name || '')).lastIndexOf(true);
    const known = new Map();
    return rounds.map((round, index) => {
      const result = {};
      for (const m of round.matches || []) {
        const d = m.draw_stage, code = /^GRP-[A-H]-([1-5])$/.exec(m.bracket_code || '');
        const name = round.round_name || '';
        let lane;
        if (d) lane = d.step === 1 || d.branch === 'winner' ? 'winner' : d.branch === 'loser' ? 'loser' : 'final';
        else if (code) lane = Number(code[1]) <= 3 ? 'winner' : Number(code[1]) === 4 ? 'loser' : 'final';
        else if (loserName.test(name) && !winnerName.test(name)) lane = 'loser';
        else if (winnerName.test(name) && !loserName.test(name)) lane = 'winner';
        else if (grouped && /双败|雙敗/.test(name)) {
          const incoming = edges.filter(e => e.targetId === m.id && known.has(e.sourceId));
          lane = incoming.length && incoming.every(e => e.kind === 'loser') ? 'loser'
            : /(?:第\s*[三3]\s*[轮輪回]|出线|出線)/.test(name) ? 'final' : 'winner';
        } else lane = !isFinalRound(round) && ((firstBranch >= 0 && index < firstBranch)
          || (named && index < lastLoser && /本戦|本赛|本賽/.test(name))) ? 'winner' : 'final';
        result[m.id] = lane; known.set(m.id, lane);
      }
      return result;
    });
  }
  // Grouped double-elimination rounds can hold several independent groups side
  // by side in the same columns. When the source records neither winner/loser
  // branch names nor group codes, the confirmed edges still separate the
  // groups; returning one block map per round lets the layout keep every group
  // together. Unknown or non-parallel draws return null and keep the lanes.
  function doubleEliminationBlocks(rounds, edges) {
    if (!rounds.length) return null;
    const name = r => r.round_name || '';
    if (rounds.some(r => (r.matches || []).some(m => m.draw_stage || /^GRP-/.test(m.bracket_code || '')))) return null;
    if (rounds.some(r => /胜者|勝者|败者|敗者|胜部|勝部|败部|敗部/.test(name(r)))) return null;
    // The group phase is the leading block of double-elimination rounds.
    const openEnd = rounds.findIndex(r => !/双败|雙敗/.test(name(r)));
    const groupCount = openEnd < 0 ? rounds.length : openEnd;
    // Parallel groups share the same columns start to finish; a lone later
    // double-elimination round is a different draw and keeps its old layout.
    if (groupCount < 2 || rounds.slice(groupCount).some(r => /双败|雙敗/.test(name(r)))) return null;
    const stageOf = new Map();
    rounds.slice(0, groupCount).forEach((round, index) => (round.matches || []).forEach(m => stageOf.set(m.id, index)));
    const parent = new Map([...stageOf.keys()].map(id => [id, id]));
    const find = id => {
      let root = id;
      while (parent.get(root) !== root) root = parent.get(root);
      while (parent.get(id) !== root) { const next = parent.get(id); parent.set(id, root); id = next; }
      return root;
    };
    for (const edge of edges) {
      if (!parent.has(edge.sourceId) || !parent.has(edge.targetId)) continue;
      const a = find(edge.sourceId), b = find(edge.targetId);
      if (a !== b) parent.set(a, b);
    }
    const rank = new Map();
    rounds.slice(0, groupCount).forEach(round => (round.matches || []).forEach(m => {
      const root = find(m.id);
      if (!rank.has(root)) rank.set(root, rank.size);
    }));
    if (rank.size < 2) return null;
    // Every block must start in the first group round, otherwise the split is
    // not a set of parallel groups and the old layout is the safer drawing.
    const firstRound = new Set((rounds[0].matches || []).map(m => find(m.id)));
    if ([...rank.keys()].some(root => !firstRound.has(root))) return null;
    return rounds.map((round, index) => {
      const block = {};
      if (index < groupCount) for (const m of round.matches || []) block[m.id] = rank.get(find(m.id));
      return block;
    });
  }
  const isFullDouble = rounds => !rounds.some(r=>r.matches.some(m=>m.draw_stage || /^GRP-/.test(m.bracket_code || '')))
    && rounds.some(isLoserRound);
  function orderFullDouble(rounds) {
    if (!isFullDouble(rounds)) return rounds;
    const dateOf=r=>r.matches.map(m=>dateKey(m.date)).filter(Boolean).sort()[0] || '';
    return [...rounds].sort((a,b)=>Number(isFinalRound(a))-Number(isFinalRound(b)) ||
      (dateOf(a)&&dateOf(b) ? dateOf(a).localeCompare(dateOf(b)) : 0));
  }

  // Extract Class A (parallel 4-player GSL double-elimination groups) separately from
  // Class B (full-bracket winner/loser lanes), returning structured groups + the
  // remaining single-elimination knockout rounds + confirmed R1 origin tags (A1/B2).
  function extractGroupDoubleElimination(rounds, data) {
    if (!Array.isArray(rounds) || !rounds.length) return null;
    const isFullBranchName = name => /^(?:本赛|本賽|本戦)?[｜|]?(?:胜者|勝者|败者|敗者|败部|敗部)(?:组|組)?(?:第\d+[轮回]|半决赛|準決勝|决赛|決賽)|^(?:总决赛|總決賽|败者决赛|敗者決賽|胜者决赛|勝者決賽)$/.test(String(name || '').replace(/\s+/g, ''));
    if (rounds.some(r => isFullBranchName(r.round_name))) return null;

    const GRP_RE = /^GRP-([A-H])-([1-5])$/;
    const winIdOf = m => m?.winner?.id || m?.winner_id || '';
    const pairIdsOf = m => participants(m).map(p => p?.id).filter(Boolean);
    const makeGroup = (key, label) => ({
      key,
      label: label || (/^\d+$/.test(key) ? `${key}组` : `${key}组`),
      first: [],
      winners: null,
      losers: null,
      decider: null,
      extraGames: [],
    });
    const assignExtraMatches = (groupsMap, extras) => {
      for (const m of extras) {
        const noteHit = /([A-H])组/.exec(String(m.notes || '') + ' ' + String(m.round_name || ''));
        if (noteHit && groupsMap.has(noteHit[1])) {
          groupsMap.get(noteHit[1]).extraGames.push(m);
          continue;
        }
        const ids = pairIdsOf(m);
        let placed = false;
        if (ids.length) {
          for (const g of groupsMap.values()) {
            const gMatches = [...g.first, g.winners, g.losers, g.decider].filter(Boolean);
            const gIds = new Set(gMatches.flatMap(pairIdsOf));
            if (ids.every(id => gIds.has(id))) {
              g.extraGames.push(m);
              placed = true;
              break;
            }
          }
        }
        if (!placed) return false;
      }
      return true;
    };

    let end = 0;
    const groupsMap = new Map();
    let mode = '';

    // 1) Explicit GRP-[A-H]-[1-5] coded opening rounds (e.g., Samsung Cup 14–23).
    const r0Matches = rounds[0]?.matches || [];
    const r0Coded = r0Matches.filter(m => GRP_RE.test(m.bracket_code || ''));
    if (r0Matches.length && r0Coded.length >= 8 && r0Coded.length >= r0Matches.length * 0.85) {
      mode = 'grp';
      const extras = [];
      for (let i = 0; i < rounds.length; i++) {
        const ms = rounds[i].matches || [];
        if (!ms.length) break;
        const coded = ms.filter(m => GRP_RE.test(m.bracket_code || ''));
        if (!coded.length) break;
        if (i > 0 && coded.length !== ms.length) break;
        end = i + 1;
        for (const m of ms) {
          const hit = GRP_RE.exec(m.bracket_code || '');
          if (!hit) { extras.push(m); continue; }
          const [, letter, stepStr] = hit;
          const step = Number(stepStr);
          if (!groupsMap.has(letter)) groupsMap.set(letter, makeGroup(letter, `${letter}组`));
          const g = groupsMap.get(letter);
          if (step <= 2) g.first.push(m);
          else if (step === 3 && !g.winners) g.winners = m;
          else if (step === 4 && !g.losers) g.losers = m;
          else if (step === 5 && !g.decider) g.decider = m;
          else g.extraGames.push(m);
        }
        if (i === 0 && coded.length < ms.length) break;
      }
      if (rounds.slice(end).some(r => (r.matches || []).some(m => GRP_RE.test(m.bracket_code || '')))) return null;
      if (!assignExtraMatches(groupsMap, extras)) return null;
    }

    // 2) Korean GSL stages tagged with draw_stage (e.g., kr_ryongseong, kr_future_02).
    if (!mode && r0Matches.length && r0Matches.every(m => m.draw_stage?.size && m.draw_stage?.group)) {
      mode = 'draw_stage';
      const leadSize = r0Matches[0].draw_stage.size;
      while (end < rounds.length) {
        const ms = rounds[end].matches || [];
        if (!ms.length || !ms.every(m => m.draw_stage?.size === leadSize && m.draw_stage?.group)) break;
        end += 1;
      }
      const rest = rounds.slice(end);
      if (rest.some(r => /双败|雙敗|胜者|勝者|败者|敗者|败部|敗部/.test(r.round_name || '')
        || (r.matches || []).some(m => m.draw_stage))) return null;
      for (const r of rounds.slice(0, end)) {
        for (const m of r.matches || []) {
          const d = m.draw_stage;
          const key = String(d.group);
          if (!groupsMap.has(key)) groupsMap.set(key, makeGroup(key, `${key}组`));
          const g = groupsMap.get(key);
          if (d.step === 1) g.first.push(m);
          else if (d.branch === 'winner' && !g.winners) g.winners = m;
          else if (d.branch === 'loser' && !g.losers) g.losers = m;
          else if (d.branch === 'qualify' && !g.decider) g.decider = m;
          else g.extraGames.push(m);
        }
      }
    }

    // 3) Leading double-elimination rounds without GRP- or draw_stage (e.g., GLOBIS Cup, fx_groupdouble).
    if (!mode && /双败|雙敗/.test(rounds[0]?.round_name || '') && r0Matches.length) {
      mode = 'connected';
      while (end < rounds.length && /双败|雙敗/.test(rounds[end].round_name || '') && (rounds[end].matches || []).length) {
        end += 1;
      }
      const rest = rounds.slice(end);
      if (rest.some(r => /双败|雙敗|胜者|勝者|败者|敗者|败部|敗部/.test(r.round_name || '')
        || (r.matches || []).some(m => m.draw_stage || /^GRP-/.test(m.bracket_code || '')))) return null;

      const entries = [];
      rounds.slice(0, end).forEach((round, roundIndex) => {
        (round.matches || []).forEach(m => entries.push({m, round, roundIndex}));
      });
      if (!entries.length) return null;

      const explicitKey = name => {
        const clean = String(name || '').replace(/\s+/g, '');
        const hit = /([A-H])组|双败淘汰([A-H])[123]/.exec(clean);
        return hit ? (hit[1] || hit[2]) : null;
      };
      const allNamed = entries.every(e => explicitKey(e.round.round_name));
      const buckets = new Map();

      if (allNamed) {
        for (const e of entries) {
          const key = explicitKey(e.round.round_name);
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(e);
        }
      } else {
        const parent = entries.map((_, i) => i);
        const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
        const byPlayer = new Map();
        entries.forEach((e, idx) => {
          for (const pid of pairIdsOf(e.m)) {
            if (!byPlayer.has(pid)) byPlayer.set(pid, idx);
            else {
              const a = find(byPlayer.get(pid)), b = find(idx);
              if (a !== b) parent[b] = a;
            }
          }
        });
        const compMap = new Map();
        entries.forEach((e, idx) => {
          const root = find(idx);
          if (!compMap.has(root)) compMap.set(root, []);
          compMap.get(root).push(e);
        });
        const comps = [...compMap.values()];
        if (comps.length < 2 || comps.some(c => c.length > 5)) return null;
        comps.forEach((comp, i) => {
          const letter = i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
          buckets.set(letter, comp);
        });
      }

      const stepHint = name => {
        const clean = String(name || '').replace(/\s+/g, '');
        if (/第\s*3\s*[轮回]|复活|最終|最终|[A-H]3$/.test(clean)) return 3;
        if (/胜者|勝者/.test(clean)) return 2;
        if (/败者|敗者|败部|敗部/.test(clean)) return 2;
        if (/第\s*2\s*[轮回]|[A-H]2$/.test(clean)) return 2;
        if (/第\s*1\s*[轮回]|[A-H]1$/.test(clean)) return 1;
        return 0;
      };

      for (const [key, groupEntries] of buckets) {
        const distinctPlayers = new Set(groupEntries.flatMap(e => pairIdsOf(e.m)));
        if (distinctPlayers.size > 4 || groupEntries.length > 5) return null;
        const g = makeGroup(key, `${key}组`);
        const hinted = groupEntries.map(e => ({...e, hint: stepHint(e.round.round_name)}));
        const hasExplicitFirst = hinted.some(e => e.hint === 1);
        const minRoundIdx = Math.min(...hinted.map(e => e.roundIndex));
        for (const e of hinted) {
          const isFirst = hasExplicitFirst ? e.hint === 1 : e.roundIndex === minRoundIdx;
          if (isFirst && g.first.length < 2) g.first.push(e.m);
        }
        if (!g.first.length || g.first.length > 2) return null;

        const firstSet = new Set(g.first);
        const firstWinners = new Set(g.first.map(winIdOf).filter(Boolean));
        const firstLosers = new Set(g.first.flatMap(m => {
          const w = winIdOf(m);
          return w ? pairIdsOf(m).filter(id => id !== w) : [];
        }));

        const remaining = hinted.filter(e => !firstSet.has(e.m));
        const deciders = remaining.filter(e => e.hint === 3);
        const stepTwos = remaining.filter(e => e.hint !== 3);

        for (const e of stepTwos) {
          const clean = String(e.round.round_name || '');
          const pids = pairIdsOf(e.m);
          if (/胜者|勝者/.test(clean) && !g.winners) { g.winners = e.m; continue; }
          if (/败者|敗者|败部|敗部/.test(clean) && !g.losers) { g.losers = e.m; continue; }
          if (pids.length && pids.every(id => firstWinners.has(id)) && !g.winners) { g.winners = e.m; continue; }
          if (pids.length && pids.every(id => firstLosers.has(id)) && !g.losers) { g.losers = e.m; continue; }
          if (!deciders.length && !g.decider && pids.some(id => firstWinners.has(id)) && pids.some(id => firstLosers.has(id))) {
            g.decider = e.m; continue;
          }
          g.extraGames.push(e.m);
        }
        for (const e of deciders) {
          if (!g.decider) g.decider = e.m;
          else g.extraGames.push(e.m);
        }
        groupsMap.set(key, g);
      }
    }

    if (!mode || groupsMap.size < 2 || end === 0) return null;
    const groups = [...groupsMap.values()].sort((a, b) =>
      String(a.key).localeCompare(String(b.key), 'en', {numeric: true}));

    // Final validation: every group holds at most 4 distinct players and <= 2 opening games.
    for (const g of groups) {
      const core = [...g.first, g.winners, g.losers, g.decider].filter(Boolean);
      const pids = new Set(core.flatMap(pairIdsOf));
      if (g.first.length > 2 || pids.size > 4 || (!core.length && !g.extraGames.length)) return null;
      g.first.sort((a, b) => {
        const ac = GRP_RE.exec(a.bracket_code || ''), bc = GRP_RE.exec(b.bracket_code || '');
        if (ac && bc) return Number(ac[2]) - Number(bc[2]);
        return (a.match_number || 0) - (b.match_number || 0);
      });
      g.qualifiers = [];
      const prefix = /^\d+$/.test(g.key) ? `${g.key}组` : g.key;
      const wWinId = winIdOf(g.winners);
      if (wWinId) {
        const p = participants(g.winners).find(x => x.id === wWinId) || g.winners.winner;
        if (p?.id) g.qualifiers.push({player: p, seed: 1, tag: `${prefix}1`});
      }
      const dWinId = winIdOf(g.decider);
      if (dWinId) {
        const p = participants(g.decider).find(x => x.id === dWinId) || g.decider.winner;
        if (p?.id) g.qualifiers.push({player: p, seed: 2, tag: `${prefix}2`});
      }
    }

    const groupRounds = rounds.slice(0, end);
    const knockoutRounds = rounds.slice(end);
    const allMatches = groupRounds.flatMap(r => r.matches || []);
    const matchIds = new Set(allMatches.map(m => m.id).filter(Boolean));
    const dates = allMatches.map(m => dateKey(m.date)).filter(Boolean).sort();
    const dateRange = dates.length ? (dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} ～ ${dates.at(-1)}`) : '';

    const qualifierOriginMap = Object.create(null);
    for (const g of groups) {
      for (const q of g.qualifiers) {
        if (q.player?.id && !qualifierOriginMap[q.player.id]) {
          qualifierOriginMap[q.player.id] = {groupKey: g.key, groupLabel: g.label, seed: q.seed, tag: q.tag};
        }
      }
    }

    const leadSize = Number(/(\d+)强/.exec(groupRounds[0]?.round_name || '')?.[1]) || (groups.length * 4);
    const title = `${leadSize}强小组双败`;

    return {
      title,
      dateRange,
      groups,
      groupRounds,
      knockoutRounds,
      matchIds,
      totalGames: allMatches.length,
      qualifierOriginMap,
      data,
    };
  }
  function prelimRegionOf(round) {
    const name = round.round_name || '';
    if (PRELIM_STAGE_PREFIX.test(name)) {
      const region = /^(中国|韩国|日本)(?:选拔|预选)/.exec(name.replace(PRELIM_STAGE_PREFIX, ''));
      return region?.[1] || '预选/复赛';
    }
    if (name === '统合预选') return '综合预选';
    const m = /预选赛（([^）]+)）/.exec(name);
    if (!m) return '其他地区';
    const word = m[1];
    if (word === '中国') return '中国';
    if (word === '日本') return '日本';
    if (word === '韩国') return '韩国';
    if (word === '中华台北') return '中国台湾';
    if (word === '统合') return '综合预选';
    return '其他地区';
  }
  // 预选赛段可以再按组别分节：轮名末段可以是组名或「组别＋轮次」（如
  // 「预选/复赛｜综合预选｜公开组第1组第1轮」「预选/复赛｜世界组第5轮」），
  // 取出组别名作为分节标题；「中国预选第1轮」这类地区写法不含组别，仍按地区分节。
  const PRELIM_GROUP_TAIL = /(?:第[\d一二三四五六七八九十百]+轮|决赛|決勝|半决赛|準決勝|[\d一二三四五六七八九十百]+强赛?|第[\d一二三四五六七八九十/]+局)$/;
  const PRELIM_GROUP_PARENTHETICAL = /[（(]([^()（）]{1,9}组)[）)]$/;
  const PRELIM_GROUP_WORDS = ['预选赛', '预选', '预赛', '予選', '初赛', '复赛'];
  function prelimGroupOf(round) {
    const name = String(round.round_name || '').trim();
    if (!/[｜|]/.test(name)) return null;
    const last = name.split(/[｜|]/).pop().trim();
    const parenthetical = PRELIM_GROUP_PARENTHETICAL.exec(last);
    let label = parenthetical?.[1] || last.replace(PRELIM_GROUP_TAIL, '').replace(/(?:预选|予選|本战)$/, '').trim();
    if (!label) return null;
    // 赛事名常与组别连写（「农心辛拉面杯…预选D组」「预选赛40以上组」），
    // 取最后一个预选类词之后的组别名；不保留「赛」这类残留字。
    let cut = -1;
    for (const word of PRELIM_GROUP_WORDS) cut = Math.max(cut, label.lastIndexOf(word));
    if (cut >= 0) label = label.slice(cut);
    label = label.replace(/^(?:预选赛|预选|预赛|予選|初赛|复赛)赛?/, '').replace(/组组$/, '组').trim();
    if (!label.endsWith('组') || label.length > 10) return null;
    return label;
  }
  function prelimRoundTailLabel(round, groupLabel) {
    let label = String(round?.round_name || '').replace('（统合）', '').trim();
    if (groupLabel) {
      const parenthetical = PRELIM_GROUP_PARENTHETICAL.exec(label);
      if (parenthetical?.[1] === groupLabel) {
        const withoutGroup = label.slice(0, parenthetical.index);
        return withoutGroup.match(PRELIM_GROUP_TAIL)?.[0] || roundDisplayName(round);
      }
      const idx = label.indexOf(groupLabel);
      if (idx >= 0) {
        const tail = label.slice(idx + groupLabel.length).replace(/^[｜|]\s*/, '').trim();
        if (tail) return tail;
      }
    }
    label = label.replace(PRELIM_STAGE_PREFIX, '').replace(/^(?:综合预选|统合预选)\s*[｜|]\s*/, '').trim();
    return label || roundDisplayName(round);
  }
  function prelimGroupTree(group) {
    const rawRounds = group?.rounds || [];
    if (rawRounds.length < 2) return null;
    if (rawRounds.some(round => !(round?.matches || []).length)) return null;
    const lastRound = rawRounds[rawRounds.length - 1];
    if ((lastRound.matches || []).length !== 1) return null;

    const stageMaps = rawRounds.map(round => new Map((round.matches || []).map(match => [match.id, match])));
    const feederCounts = new Map();
    const edges = [];

    for (let i = 0; i < rawRounds.length - 1; i++) {
      const nextMap = stageMaps[i + 1];
      for (const match of (rawRounds[i].matches || [])) {
        if (!match?.id || !match.next_match_id) return null;
        const target = nextMap.get(match.next_match_id);
        if (!target) return null;
        const winId = match.winner?.id || match.winner_id || '';
        const winnerObj = match.winner?.id ? match.winner : (winId ? {id: winId, name_zh: match.winner?.name_zh || ''} : null);
        if (winId && !hasPlayer(target, winnerObj)) return null;
        const feeders = (feederCounts.get(target.id) || 0) + 1;
        if (feeders > 2) return null;
        feederCounts.set(target.id, feeders);
        edges.push({
          sourceId: match.id,
          targetId: target.id,
          player: winnerObj?.name_zh || '',
          kind: winId ? 'winner' : 'scheduled',
        });
      }
    }

    const rounds = rawRounds.map(round => ({
      ...round,
      source_round_name: round.source_round_name || round.round_name,
      round_name: prelimRoundTailLabel(round, group.label),
    }));
    const finalMatch = lastRound.matches[0];
    return {
      rounds,
      edges,
      qualifier: finalMatch?.winner?.id ? finalMatch.winner : null,
      allExplicit: true,
    };
  }
  function prelimTreeGroups(data) {
    const groups = prelimGroups(data).map(group => ({
      ...group,
      key: `${group.region}::${group.label || ''}`,
      tree: prelimGroupTree(group),
    }));
    return {groups, hasTrees: groups.some(group => Boolean(group.tree))};
  }
  function prelimGroups(data) {
    const sections = new Map();
    for (const round of (data.rounds || [])) {
      if (!isPrelimRound(round)) continue;
      const display = prelimDisplayRound(round);
      const region = prelimRegionOf(display);
      const label = prelimGroupOf(display);
      const key = `${region}::${label || ''}`;
      if (!sections.has(key)) {
        sections.set(key, {region, label, rounds: [], first: round.round_order ?? 0});
      }
      sections.get(key).rounds.push(display);
    }
    return [...sections.values()]
      .sort((a, b) => PRELIM_REGION_ORDER.indexOf(a.region) - PRELIM_REGION_ORDER.indexOf(b.region)
        || a.first - b.first)
      .map(section => ({
        region: section.region, label: section.label, rounds: section.rounds,
        games: section.rounds.reduce((n, r) => n + (r.matches?.length || 0), 0),
      }));
  }
  // 只凭对局原轮次判定为预选的赛段，按来源的原始轮次名显示：否则“决赛”
  // 这类本赛名称会出现在预选分组里。
  const ORIGIN_LABEL = /原轮次[：:]\s*([^；\n]+)/;
  function prelimDisplayRound(round) {
    const name = String(round.round_name || '').trim();
    // 待核赛段名里已写明预选阶段时，按原轮次名显示在预选分组，不再占待核列表。
    if (PARKED_PRELIM_NAME.test(name)) {
      const tail = name.replace(/^赛段待核\s*[｜|]\s*/, '').replace(/^本赛\s*[｜|]\s*/, '');
      return {...round, source_round_name: name, round_name: '预选/复赛｜' + tail};
    }
    const named = PRELIM_STAGE_PREFIX.test(name)
      || /预选|预赛|本选|予選|예선|선발전|选拔|ファースト/.test(name.replace(/\s+/g, ''));
    if (named || PENDING_ROUND_NAME.test(name)) return round;
    const matches = round.matches || [];
    if (!matches.length || !matches.every(m => PRELIM_ORIGIN.test(String(m.notes || '')))) return round;
    const hit = matches.map(m => ORIGIN_LABEL.exec(String(m.notes || ''))).find(Boolean);
    return hit ? {...round, source_round_name: name, round_name: '预选/复赛｜' + hit[1].trim()} : round;
  }
  function sourceRoundsForView(data) {
    if (isTeamCompetition(data)) return {mainRounds:(data.rounds || []).filter(r=>!isPrelimRound(r)&&!isUnclassifiedRound(r)),thirdPlaceRound:null,
      prelimRounds:(data.rounds || []).filter(isPrelimRound).map(prelimDisplayRound),unclassifiedRounds:(data.rounds || []).filter(isUnclassifiedRound)};
    const mainRounds = [], thirdPlaceRounds = [], prelimRounds = [], unclassifiedRounds = [];
    for (const round of data.rounds || []) {
      if (isPrelimRound(round)) { prelimRounds.push(prelimDisplayRound(round)); continue; }
      if (isUnclassifiedRound(round)) { unclassifiedRounds.push(round); continue; }
      if (/季军|季軍|三四名|三、四名|三位|3位|3rd/i.test(round.round_name || '')) {
        thirdPlaceRounds.push(round);
      } else if (round.matches.length === 40 && round.matches.every(m => /^GRP-[A-H]-[1-5]$/.test(m.bracket_code || ''))) {
        for (const [i, stages] of [[1, [1, 2]], [2, [3, 4]], [3, [5]]]) {
          mainRounds.push({...round, id: `${round.id}_stage${i}`, round_order: `${round.round_order}_${i}`,
            round_name: ['小组双败 · 首轮', '小组双败 · 胜者战 / 败者战', '小组双败 · 出线战'][i - 1],
            matches: round.matches.filter(m => stages.includes(Number(m.bracket_code.slice(-1))))});
        }
      } else {
        const titleEvent = ['jp_kisei','jp_meijin','jp_oza','jp_tengen','jp_gosei','jp_jyudan','jp_fhoninbo','jp_fmeijin','jp_fkisei','jp_aidu'].includes(data.tournament?.id)
          || data.tournament?.id === 'jp_honinbo';
        mainRounds.push(titleEvent && /^本戦(?:トーナメント)?[｜|]決勝$/.test(round.round_name || '')
          ? {...round,source_round_name:round.round_name,round_name:'本赛｜挑战者决定战'} : round);
      }
    }
    let arranged = combineSeriesLegStages(combineTrailingTitleSeries(combineFinalSeriesRounds(orderFullDouble(combineKnockoutAliases(combineSeriesLegs(combineGroupRounds(organizeParallelRounds(mainRounds, data))),data)))));
    const editionNumber = Number(data.edition?.edition_number);
    if (data.tournament?.id === 'jp_kisei' && editionNumber >= 25 && editionNumber <= 39) {
      // Official A/B league tables identify these anchors. Only split a full,
      // unambiguous pair of six-player round robins; anomalies remain intact.
      const anchors = {25:'awaji_shuzo',26:'cho_sonjin',27:'ryu_shikun',28:'hane_naoki',29:'yamashita_keigo',
        30:'yuki_satoshi',31:'hane_naoki',32:'kobayashi_satoru',33:'iyama_yuta',
        34:'yoda_norimoto',35:'yamashita_keigo',36:'iyama_yuta',37:'takao_shinji',
        38:'yamashita_keigo',39:'yamashita_keigo'};
      const extraIds = {
        27:['hotongo_m_20907'],
        38:['hotongo_m_108677','hotongo_m_109662','hotongo_m_110059','hotongo_m_111316','hotongo_m_111849'],
        39:['hotongo_m_122848','hotongo_m_122915','hotongo_m_123262','hotongo_m_123489','hotongo_m_123590',
          'hotongo_m_124710','hotongo_m_125074','hotongo_m_125946','hotongo_m_125949']
      };
      const anchor = anchors[editionNumber];
      arranged = arranged.flatMap(round => {
        if (!anchor || !/^循环圈戦[｜|]?$/.test(round.round_name || '')) return [round];
        // Additional source games have a participant or identity mismatch;
        // keep them separately while the official tables supply group records.
        const extraSet = new Set(extraIds[editionNumber] || []);
        const extras = round.matches.filter(g => extraSet.has(g.id));
        const games = round.matches.filter(g => !extras.includes(g));
        if (games.length !== 30 || extras.length !== extraSet.size) return [round];
        const graph = new Map();
        for (const game of games) {
          const [a,b] = participants(game).map(p => p.id);
          if (!a || !b || a === b) return [round];
          if (!graph.has(a)) graph.set(a, new Set());
          if (!graph.has(b)) graph.set(b, new Set());
          graph.get(a).add(b); graph.get(b).add(a);
        }
        if (graph.size !== 12 || [...graph.values()].some(neighbors => neighbors.size !== 5) || !graph.has(anchor)) return [round];
        const groupA = new Set([anchor, ...graph.get(anchor)]);
        const a = [], b = [];
        for (const game of games) {
          const ids = participants(game).map(p => p.id), inA = ids.map(id => groupA.has(id));
          if (inA[0] !== inA[1]) return [round];
          (inA[0] ? a : b).push(game);
        }
        if (a.length !== 15 || b.length !== 15) return [round];
        return [
          {...round, id:round.id+'_A', round_name:'A循环圈', matches:a, source_rounds:[round]},
          {...round, id:round.id+'_B', round_name:'B循环圈', matches:b, source_rounds:[round]},
          ...(extras.length ? [{...round, id:round.id+'_other', round_name:'循环圈其他对局', matches:extras, source_rounds:[round]}] : [])
        ];
      });
    }
    // The B-group playoff precedes the challenger ladder, not the league tables.
    if (data.tournament?.id === 'jp_kisei' && editionNumber >= 44 && editionNumber <= 49) {
      const playoff = arranged.find(r => /^Bリーグ[｜|]勝者$/.test(r.round_name || '') && r.matches.length === 1);
      const first = arranged.find(r => /挑戦者決定トーナメント.*阶梯第2阶段/.test(r.round_name || ''));
      if (playoff && first) {
        arranged = arranged.filter(r => r !== playoff);
        arranged.splice(arranged.indexOf(first), 0, {...playoff, round_name:'B组优胜者决定战'});
      }
    }
    if (data.edition?.id === 'jp_kisei_041') {
      // The import combined two dates and the series winner into one row.
      // Show the sourced series result as a summary rather than as a single
      // game; the individual-game correction remains a database task.
      arranged = arranged.map(r => {
        if (r.id === 'pro_r_aa0b6e9b01f903a0' && r.matches.length === 2) {
          const expected = new Map([['pro_m_29c1619ffd691abb','zhang_xu'],
            ['jp_kisei_041_challenger_g2','kono_rin']]);
          if (new Set(r.matches.map(g => g.id)).size === 2 && r.matches.every(g => {
            const ids = participants(g).map(p => p.id);
            return !isNoResult(g) && ids.includes('kono_rin') && ids.includes('zhang_xu') &&
              expected.get(g.id) === g.winner?.id;
          })) return {...r, round_name:'挑战者决定战（河野先得一胜）',
            series_advantage_note:'河野临先得一胜', series_winner_id:'kono_rin', series_score:'2-1'};
        }
        const game = r.matches?.[0], ids = game ? participants(game).map(p => p.id) : [];
        if (r.id !== 'pro_r_aa0b6e9b01f903a0' || r.matches.length !== 1 ||
            game.id !== 'pro_m_29c1619ffd691abb' || game.date !== '2016-11-10' ||
            game.winner?.id !== 'kono_rin' || !ids.includes('kono_rin') || !ids.includes('zhang_xu')) return r;
        return {...r, round_name:'挑战者决定战（河野先得一胜）', date_range:'2016-11-10 ～ 2016-11-14',
          matches:[{...game, date:'2016-11-10 ～ 2016-11-14', series_score:'2-1',
            series_winner_id:'kono_rin', result_detail:'2-1 胜出',
            tooltip:'河野临先得一胜；两局各胜一局，逐局记录待更正'}]};
      });
    }
    if (data.edition?.id === 'jp_kisei_045') {
      arranged = arranged.map(r => {
        if (r.id !== 'jp_kisei_045_challenger' || r.matches.length !== 2) return r;
        const expected = new Map([['jp_kisei_045_challenger_g1','takao_shinji'],
          ['jp_kisei_045_challenger_g2','kono_rin']]);
        if (new Set(r.matches.map(g => g.id)).size !== 2 || !r.matches.every(g => {
          const ids = participants(g).map(p => p.id);
          return !isNoResult(g) && ids.includes('kono_rin') && ids.includes('takao_shinji') &&
            expected.get(g.id) === g.winner?.id;
        })) return r;
        return {...r, round_name:'挑战者决定战（河野先得一胜）',
          series_advantage_note:'河野临先得一胜', series_winner_id:'kono_rin', series_score:'2-1'};
      });
    }
    if (data.edition?.id === 'jp_kisei_047') {
      arranged = arranged.map(r => {
        if (r.id !== 'pro_r_70dd09e3616b49ad') return r;
        const expected = new Map([['pro_m_bbd6c0b766d7c17e','yamashita_keigo'],
          ['pro_m_907fa6766630852d','shibano_toramaru']]);
        const games = r.matches || [];
        if (games.length !== 2 || new Set(games.map(g => g.id)).size !== 2 || !games.every(g => {
          const ids = participants(g).map(p => p.id);
          return !isNoResult(g) && ids.includes('shibano_toramaru') && ids.includes('yamashita_keigo') &&
            expected.get(g.id) === g.winner?.id;
        })) return r;
        return {...r, round_name:'挑战者决定战（芝野先得一胜）', series_advantage_note:'芝野虎丸先得一胜',
          series_winner_id:'shibano_toramaru', series_score:'2-1'};
      });
    }
    if (data.edition?.id === 'jp_kisei_036') {
      // The official challenger decider was filed inside a preliminary round.
      const source = prelimRounds.find(r => r.matches.some(g => g.id === 'hotongo_m_72544'));
      const game = source?.matches.find(g => g.id === 'hotongo_m_72544');
      const ids = game ? participants(game).map(p => p.id) : [];
      const finalIndex = arranged.findIndex(isFinalRound);
      if (game && ids.includes('iyama_yuta') && ids.includes('takao_shinji') &&
          game.winner?.id === 'takao_shinji' && game.date === '2011-11-11' && finalIndex >= 0 &&
          arranged[finalIndex].matches.some(g => participants(g).some(p => p.id === 'takao_shinji'))) {
        const index = prelimRounds.indexOf(source);
        prelimRounds[index] = {...source, matches:source.matches.filter(g => g !== game)};
        arranged.splice(finalIndex, 0, {...source, id:source.id+'_decider', round_name:'挑战者决定战',
          date_range:game.date, matches:[game], source_rounds:[source]});
      }
    }
    // The B-league playoff was imported among the league rounds. On the draw it
    // feeds the first challenger-ladder game, after the league tables.
    if (data.edition?.id === 'jp_kisei_050') {
      const playoff = arranged.find(r => r.id === 'pro_r_5596f646e572156b');
      const first = arranged.find(r => r.id === 'pro_r_004dc318276f5cbf');
      if (playoff && first) {
        arranged = arranged.filter(r => r !== playoff);
        arranged.splice(arranged.indexOf(first), 0, {...playoff, round_name: 'B组优胜者决定战'});
      }
      const labels = {'pro_r_004dc318276f5cbf':'挑战者决定赛第1轮',
        'pro_r_e1119f71f69d4458':'挑战者决定赛第2轮',
        'pro_r_66fcc657e333c0a8':'挑战者决定赛第3轮'};
      arranged = arranged.map(r => {
        if (labels[r.id]) return {...r, round_name: labels[r.id]};
        if (r.id !== 'pro_r_c74b5d7cdd7a2cc8') return r;
        // Official rules give S-league first place one win in the best-of-three.
        // The two recorded games were split; Shibano therefore advanced 2–1.
        const games = r.matches || [];
        const expected = new Map([['pro_m_926705dddeebeea8','xu_jiayuan'],
          ['pro_m_4271d7919dd4ac68','shibano_toramaru']]);
        if (games.length !== 2 || !games.every(g => {
          const ids = participants(g).map(p => p.id);
          return !isNoResult(g) && ids.includes('shibano_toramaru') && ids.includes('xu_jiayuan') &&
            expected.get(g.id) === g.winner?.id;
        }) || new Set(games.map(g => g.id)).size !== 2) return r;
        return {...r, round_name:'挑战者决定战（芝野先得一胜）', series_advantage_note:'芝野虎丸先得一胜',
          series_winner_id:'shibano_toramaru', series_score:'2-1'};
      });
    }
    return {mainRounds: arranged, thirdPlaceRound: thirdPlaceRounds.length ? {
      ...thirdPlaceRounds[0], matches: thirdPlaceRounds.flatMap(r => r.matches)
    } : null, prelimRounds, unclassifiedRounds};
  }
  function renderedMatches(data) {
    if (isTeamCompetition(data)) return (data.rounds || []).flatMap(r=>r.matches);
    const {mainRounds} = roundsForView(data);
    const knockout = mainRounds.filter(r => !isLeagueRound(r));
    const penultimate = knockout.at(-2), final = knockout.at(-1);
    return mainRounds.flatMap(r => r === penultimate
      ? aggregateSeries(r, final?.matches[0]?.id) : r.matches);
  }
  function edgesForView(data, view = roundsForView(data)) {
    if (isTeamCompetition(data)) return [];
    // League qualification is decided by group standings, not the winner of
    // the last recorded individual game (Korea Ki-in's inaugural Future Stars).
    if (data.edition?.id === 'kr_future_01') return [];
    // Each Ryusei block qualifies by longest streak and final survivor.
    const mainRounds = view.mainRounds.filter(r => !isRyuseiLadderRound(data, r));
    const knockout = mainRounds.filter(r => !isLeagueRound(r));
    const penultimate = knockout.at(-2), final = knockout.at(-1);
    const rounds = mainRounds.map(r => r === penultimate
      ? aggregateSeries(r, final?.matches[0]?.id) : r.matches);
    const nodes = rounds.flat(), byId = new Map();
    nodes.forEach(m => {byId.set(m.id, m); (m.subgames || []).forEach(g => byId.set(g.id, m));});
    const edges = [], seen = new Set();
    const fullDouble=isFullDouble(mainRounds);
    const targetsFor=(j,p)=>{
      if(isLeagueRound(mainRounds[j]) || isVagueRound(mainRounds[j])) return [];
      const targets=(rounds[j] || []).filter(n=>hasPlayer(n,p));
      // The first game anchors a final series in both display modes.
      return targets.length>1 && isFinalRound(mainRounds[j]) && finalSeries(mainRounds[j],data) ? [targets[0]] : targets;
    };
    const add = (source, target, p, kind) => {
      if (!target || source === target || !hasPlayer(target, p)) return;
      const key = `${source.id}|${target.id}|${p.name_zh || p.id}`;
      if (seen.has(key)) return;
      seen.add(key); edges.push({sourceId: source.id, targetId: target.id, player: p.name_zh, kind});
    };
    rounds.forEach((matches, i) => matches.forEach(m => {
      // Games within a final series are not separate advancement stages.
      if (i === rounds.length - 1) return;
      if (isLeagueRound(mainRounds[i]) || isVagueRound(mainRounds[i])) return;
      if(fullDouble && !m.draw_stage) {
        const advance=(p,kind)=>{
          if(!p?.id) return;
          for(let j=i+1;j<rounds.length;j++) {
            if(kind==='loser' && !isLoserRound(mainRounds[j])) continue;
            const targets=targetsFor(j,p);
            if(targets.length) {if(targets.length===1)add(m,targets[0],p,kind);return;}
          }
        };
        if(!isFinalRound(mainRounds[i])) {
          const explicit=byId.get(m.next_match_id);
          if(explicit && hasPlayer(explicit,m.winner)) add(m,explicit,m.winner,'winner');
          else advance(m.winner,'winner');
          if(!isLoserRound(mainRounds[i]) && m.winner?.id)
            participants(m).filter(p=>p.id&&!samePlayer(p,m.winner)).forEach(p=>advance(p,'loser'));
        }
        return;
      }
      if (m.draw_stage) {
        const d=m.draw_stage;
        const advance=(p,kind)=>{
          if (!p?.id) return;
          for(let j=i+1;j<rounds.length;j++) {
            const targets=targetsFor(j,p).filter(n=>{
              if(!hasPlayer(n,p)) return false;
              const nd=n.draw_stage;
              // Inside a group the branch is explicit; after qualification the
              // new draw may assign different group numbers.
              if(nd?.size===d.size) {
                if(nd.group!==d.group) return false;
                if(d.step===1) return nd.step===2 && nd.branch===(kind==='winner'?'winner':'loser');
                if(d.step===2) return nd.step===3 && (d.branch==='loser' ? kind==='winner' : kind==='loser');
                return false;
              }
              return kind==='winner' && (d.step===3 || (d.step===2 && d.branch==='winner'));
            });
            if(targets.length) {if(targets.length===1)add(m,targets[0],p,kind);return;}
          }
        };
        advance(m.winner,'winner');
        if(d.step===1 || (d.step===2 && d.branch==='winner'))
          participants(m).filter(p=>p.id&&!samePlayer(p,m.winner)).forEach(p=>advance(p,'loser'));
        return;
      }
      if (isFinalRound(mainRounds[i])) return;
      if (m.winner?.id) {
        const explicit = byId.get(m.next_match_id);
        if (explicit && hasPlayer(explicit, m.winner)) add(m, explicit, m.winner, 'winner');
        else {
          // Partial/parallel source rounds and byes can intervene. A unique
          // later appearance locates the branch; a known earlier game cannot
          // become its successor. Never jump across a league phase.
          const last = mainRounds.some(isLeagueRound) ? i + 2 : rounds.length;
          for (let j=i+1; j<last; j++) {
            const targets = targetsFor(j,m.winner).filter(n => !dateKey(m.date) || !dateKey(n.date) || dateKey(n.date) >= dateKey(m.date));
            if (!targets.length) continue;
            if (targets.length === 1) add(m, targets[0], m.winner, 'winner');
            break;
          }
        }
      }
      // Some group double-elimination sources record only round numbers, not
      // group codes. A loser's next recorded game within that same phase is
      // still identifiable when the participant has exactly one next game.
      if (/双败|雙敗/.test(mainRounds[i].round_name || '') && m.winner?.id) {
        for (const p of participants(m).filter(p => p.id && !samePlayer(p, m.winner))) {
          for (let j = i + 1; j < rounds.length && /双败|雙敗/.test(mainRounds[j].round_name || ''); j++) {
            const targets = targetsFor(j, p).filter(n => !dateKey(m.date) || !dateKey(n.date) || dateKey(n.date) >= dateKey(m.date));
            if (!targets.length) continue;
            if (targets.length === 1) add(m, targets[0], p, 'loser');
            break;
          }
        }
      }
      // A winner-bracket loss is the first loss in a double-elimination event.
      // The recorded later opponent pair identifies its loser-bracket entry.
      if (/胜者组/.test(mainRounds[i].round_name || '') && m.winner?.id) {
        for (const p of participants(m).filter(p => p.id && !samePlayer(p, m.winner))) {
          const later = rounds.slice(i + 1).flat().find(n => hasPlayer(n, p));
          add(m, later, p, 'loser');
        }
      }
      const group = /^(GRP-[A-H])-([1-5])$/.exec(m.bracket_code || '');
      if (group && m.winner?.id) {
        for (const p of participants(m).filter(p => p.id && !samePlayer(p, m.winner))) {
          const target = nodes.find(n => n.bracket_code?.startsWith(group[1] + '-') &&
            Number(n.bracket_code.slice(-1)) > Number(group[2]) && hasPlayer(n, p));
          add(m, target, p, 'loser');
        }
      }
      if (data.tournament?.id === 'tianfu' && /小组决赛/.test(mainRounds[i].round_name)) {
        for (const p of participants(m).filter(p => p.id && !samePlayer(p, m.winner))) {
          const targets = (rounds[i + 1] || []).filter(n => hasPlayer(n, p));
          if (targets.length === 1) add(m, targets[0], p, 'loser');
        }
      }
    }));
    return edges;
  }
  // Only the single-elimination draw has a unique terminal advancement tree.
  // Keep incomplete draws anchored at their last identified stage; never infer
  // missing games or a route from row order. This is a display copy only.
  function roundsForView(data) {
    const view = sourceRoundsForView(data);
    const rounds = view.mainRounds.filter(r => !isRyuseiLadderRound(data, r));
    const excluded = isTeamCompetition(data) || isMixedEliminationDraw(data) || rounds.some(r => isLeagueRound(r)
      || /双败|雙敗|败者|敗者|败部|小组|小組/.test(r.round_name || '')
      || r.matches.some(m => m.draw_stage || /^GRP-/.test(m.bracket_code || '')))
      || /三人争夺|三人爭奪|首轮败者|首輪敗者/.test((data.edition?.finals_type || '') + (data.edition?.notes || ''))
      || ['tianfu', 'cjk_ryusei', 'international_ryusei', 'world_meijin'].includes(data.tournament?.id);
    if (excluded || rounds.length < 2) return {...view, orphanRounds: []};
    const nodes = rounds.flatMap((r, i) => i === rounds.length - 2
      ? aggregateSeries(r, rounds.at(-1)?.matches[0]?.id) : r.matches);
    if (!nodes.some(m => participants(m).some(p => p.id))) return {...view, orphanRounds: []};
    const byId = new Map();
    nodes.forEach(m => {byId.set(m.id, m); (m.subgames || []).forEach(g => byId.set(g.id, m));});
    const adjacent = new Map(nodes.map(m => [m.id, new Set()]));
    const connect = (a, b) => {
      if (!a || !b || a.id === b.id) return;
      adjacent.get(a.id).add(b.id); adjacent.get(b.id).add(a.id);
    };
    edgesForView(data, view).forEach(e => connect(byId.get(e.sourceId), byId.get(e.targetId)));
    // A documented route also locates scheduled games with unknown entrants.
    nodes.forEach(m => connect(m, byId.get(m.next_match_id)));
    // All legs of an explicitly labelled match series occupy the same place,
    // including a leg lost by the player who ultimately advances.
    const series = new Map();
    rounds.forEach(r => {
      if (!/第\d+局/.test(r.round_name || '')) return;
      const stage = r.round_name.replace(/第\d+局/g, '');
      r.matches.forEach(m => {
        const ids = participants(m).map(p => p.id).sort(); if (!ids.every(Boolean)) return;
        const key = stage + '|' + ids.join('|'), node = byId.get(m.id);
        connect(node, series.get(key)); series.set(key, node);
      });
    });
    // A future final may only carry its schedule. Empty stages cannot anchor
    // the graph: use the latest populated stage until final games are known.
    const populatedRounds = rounds.filter(r => r.matches.length);
    let terminals = populatedRounds.filter(isFinalRound);
    if (!terminals.length) terminals = populatedRounds.filter(r => !isVagueRound(r)).slice(-1);
    if (!terminals.length) return {...view, orphanRounds: []};
    terminals = [...terminals, ...rounds.filter(r => /排名|順位|五六名|七八名|\d+[—\-~～至、]\d+名|第[五六七八九十\d]+名/.test(r.round_name || ''))];
    const kept = new Set(), queue = terminals.flatMap(r => r.matches.map(m => byId.get(m.id)?.id)).filter(Boolean);
    while (queue.length) {
      const id = queue.pop(); if (kept.has(id)) continue;
      kept.add(id); adjacent.get(id)?.forEach(other => queue.push(other));
    }
    const orphanRounds = [], mainRounds = [];
    view.mainRounds.forEach(r => {
      if (isRyuseiLadderRound(data, r)) {mainRounds.push(r); return;}
      const hidden = r.matches.filter(m => !kept.has(byId.get(m.id)?.id));
      const visible = r.matches.filter(m => kept.has(byId.get(m.id)?.id));
      if (hidden.length) orphanRounds.push({...r, matches:hidden, orphaned:true,
        placement_note:'未连接到本届单淘汰晋级图，待核实轮次或补齐缺局'});
      if (visible.length) mainRounds.push({...r, matches:visible});
    });
    return {...view, mainRounds, orphanRounds,
      unclassifiedRounds:[...view.unclassifiedRounds, ...orphanRounds]};
  }
  function unconfirmedLinks(data) {
    const {mainRounds} = roundsForView(data);
    const finalIds = new Set((mainRounds.at(-1)?.matches || []).map(m => m.id));
    const edges = edgesForView(data);
    // `*_series_N` 是番棋聚合出来的展示节点，不是真实对局，本身不参与连线确认。
    return renderedMatches(data).filter(m => m.winner?.id && !finalIds.has(m.id) && m.next_match_id &&
      !/_series_\d+$/.test(m.id || '') &&
      !edges.some(e => e.sourceId === m.id && e.kind === 'winner'));
  }
  function bracketEdgesForView(data, viewMode) {
    if (isTeamCompetition(data)) return [];
    const edges=edgesForView(data);
    const rounds=roundsForView(data).mainRounds.filter(r => !isRyuseiLadderRound(data, r));
    rounds.slice(0,-1).forEach((round,i)=>round.matches.forEach(source=>{
      if(source.winner?.id) return;
      const target=rounds[i+1].matches.find(m=>m.id===source.next_match_id);
      const slot=source.next_slot;
      if(target && ['participant_1','participant_2'].includes(slot) && !target[slot+'_id'])
        edges.push({sourceId:source.id,targetId:target.id,kind:'scheduled',player:''});
    }));
    if (viewMode === 'wiki' && rounds.length >= 2) {
      const r0 = rounds[0].matches || [];
      const r1 = rounds[1].matches || [];
      const r2 = rounds[2]?.matches || [];
      const size = data.edition?.bracket_size;
      const isGroupStage = (rounds[0].matches || []).some(m => /^GRP-/.test(m.bracket_code || ''));
      const isByeBracket = !isGroupStage && (size === 24 || size === 48 ||
        (size !== 32 && r0.length === 8 && r1.length === 8 && (r2.length === 4 || rounds.length === 2)) ||
        (size !== 32 && r0.length === 16 && r1.length === 16 && (r2.length === 8 || rounds.length === 2)));
      if (isByeBracket) {
        const usedFeederIds = new Set();
        r1.forEach(target => {
          const parts = participants(target);
          parts.forEach((p, slotIndex) => {
            if (!p || (!p.id && !p.name_zh)) return;
            const feeder = r0.find(m => !usedFeederIds.has(m.id) && samePlayer(m.winner, p));
            if (feeder) {
              usedFeederIds.add(feeder.id);
            } else {
              const byeId = 'bye-' + target.id + '-' + slotIndex;
              if (!edges.some(e => e.sourceId === byeId && e.targetId === target.id)) {
                edges.push({ sourceId: byeId, targetId: target.id, player: p.name_zh, kind: 'bye' });
              }
            }
          });
        });
      }
    }
    return edges;
  }
  function supportsStageDrawView(data) {
    if (!data || isTeamCompetition(data) || isMixedEliminationDraw(data)) return false;
    const rawMain = sourceRoundsForView(data).mainRounds || [];
    if (rawMain.length < 2) return false;
    const excluded = rawMain.some(r => isLeagueRound(r) || isRyuseiLadderRound(data, r)
      || /双败|雙敗|败者|敗者|胜者组|勝者組|败部|小组|小組/.test(r.round_name || '')
      || (r.matches || []).some(m => m.draw_stage || /^GRP-/.test(m.bracket_code || '')))
      || /三人争夺|三人爭奪|首轮败者|首輪敗者/.test((data.edition?.finals_type || '') + (data.edition?.notes || ''))
      || ['tianfu', 'cjk_ryusei', 'international_ryusei', 'world_meijin'].includes(data.tournament?.id);
    if (excluded) return false;
    const rounds = roundsForView(data).mainRounds || [];
    if (rounds.length < 2) return false;
    const policy = data.edition?.draw_policy;
    if (policy === 'redraw') return true;
    if (policy === 'fixed') return false;
    const finalId = rounds.find(isFinalRound)?.matches?.[0]?.id;
    return rounds.some((r, idx) => {
      if (isFinalRound(r)) return false;
      const nodes = idx === rounds.length - 2 ? aggregateSeries(r, finalId) : (r.matches || []);
      const dates = new Set(nodes.map(m => drawMatchDateKey(m)).filter(Boolean));
      return dates.size >= 2;
    });
  }
  function drawOrderValue(m) {
    const n = Number(m?.draw_order);
    return Number.isInteger(n) && n > 0 ? n : Infinity;
  }
  function drawMatchDateKey(m) {
    return dateKey(m?.date) || dateKey(m?.subgames?.[0]?.date);
  }
  function compareDrawMatches(a, b) {
    const da = drawMatchDateKey(a) || '9999-99-99';
    const db = drawMatchDateKey(b) || '9999-99-99';
    if (da !== db) return da.localeCompare(db);
    const oa = drawOrderValue(a), ob = drawOrderValue(b);
    if (oa !== ob) return oa - ob;
    const ma = Number.isFinite(Number(a?.match_number)) ? Number(a.match_number) : Infinity;
    const mb = Number.isFinite(Number(b?.match_number)) ? Number(b.match_number) : Infinity;
    if (ma !== mb) return ma - mb;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  }
  function groupRoundMatchesForDrawView(round, matchesOverride = null) {
    const raw = (matchesOverride || round?.matches || []).slice().sort(compareDrawMatches);
    const groups = [];
    const byDate = new Map();
    for (const m of raw) {
      const key = drawMatchDateKey(m) || '';
      if (!byDate.has(key)) {
        const group = {dateKey: key, label: key || (round?.date_range || '—'), matches: []};
        byDate.set(key, group);
        groups.push(group);
      }
      byDate.get(key).matches.push(m);
    }
    return groups;
  }
  function hydrateSnapshot(snapshot) {
    if (snapshot?.player_refs_version !== 1) return snapshot;
    const players = new Map((snapshot.players || []).map(p => [p.id, p]));
    function hydrate(value) {
      if (!value || typeof value !== 'object') return value;
      if (Object.keys(value).length === 1 && typeof value.$go_player_ref === 'string') {
        if (!players.has(value.$go_player_ref)) throw new Error('页面棋手引用缺失：' + value.$go_player_ref);
        return players.get(value.$go_player_ref);
      }
      for (const key of Object.keys(value)) value[key] = hydrate(value[key]);
      return value;
    }
    hydrate(snapshot.editions);
    delete snapshot.player_refs_version;
    return snapshot;
  }
  function collectPlayers(allData, directory = []) {
    const byId = new Map();
    const add = p => {if (p?.id) byId.set(p.id, p);};
    for (const ed of Object.values(allData)) {
      [ed.champion, ed.runner_up, ed.third_place, ed.fourth_place].forEach(add);
      for (const r of ed.rounds || []) for (const m of r.matches || []) {
        [...participants(m), m.winner].forEach(add);
      }
    }
    directory.forEach(add);
    return [...byId.values()];
  }
  // 棋手页“历史对局”：从当前已载入的届次中挑出该棋手的全部单局，默认按日期倒序（最新在前，无日期排在末尾）。
  // 只整理现有记录：不补推缺赛、不推断缺失赛果，也不改写任何原始字段。
  function comparePlayerGames(a, b, sort = 'desc') {
    const dir = sort === 'asc' ? 1 : -1;
    if (Boolean(a.dateKey) !== Boolean(b.dateKey)) return a.dateKey ? -1 : 1;
    if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey) * dir;
    return ((a.year - b.year) || (a.chronological - b.chronological)
      || (a.roundOrder - b.roundOrder) || (a.matchNumber - b.matchNumber)
      || a.id.localeCompare(b.id)) * dir;
  }
  function filterPlayerGames(rows, filters = {}) {
    const query = String(filters.query || '').trim().normalize('NFKC').toLocaleLowerCase();
    const category = filters.category || 'all';
    const color = filters.color || 'all';
    const outcome = filters.outcome || 'all';
    const sgfOnly = Boolean(filters.sgfOnly);
    const sort = filters.sort === 'asc' ? 'asc' : 'desc';
    return (rows || []).filter(row => {
      if (category !== 'all' && row.category !== category) return false;
      if (color === 'unknown' ? row.color !== '' : (color !== 'all' && row.color !== color)) return false;
      if (outcome !== 'all' && row.outcome?.key !== outcome) return false;
      if (sgfOnly && !row.hasSgf) return false;
      if (query) {
        const hay = [row.opponent?.name_zh, row.tournament, row.editionMeta, row.roundName, row.date]
          .filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    }).sort((a, b) => comparePlayerGames(a, b, sort));
  }
  function playerGameRows(allData, player, options = {}) {
    const idAliases = options.idAliases || {};
    const nameAliases = options.nameAliases || {};
    const indexById = new Map((options.index || []).map(item => [item.id, item]));
    const ids = new Set([player.id].filter(Boolean));
    for (const [aliasId, targetId] of Object.entries(idAliases)) {
      if (targetId === player.id) ids.add(aliasId);
    }
    const names = new Set([player.name_zh, player.name_native, player.name_romanized,
      player.name_en, player.name_ko, player.name_ja].filter(Boolean));
    for (const name of nameAliases[player.id] || []) names.add(name);

    const side = (id, ref) => {
      const info = ref && typeof ref === 'object' ? ref : {};
      return {
        id: id || info.id || '',
        name: info.name_zh || info.name_native || info.name_romanized || '',
        nationality: info.nationality || '',
      };
    };
    const isPlayer = person => person.id ? ids.has(person.id) : Boolean(person.name && names.has(person.name));
    const appearance = match => {
      const black = side(match.black_player_id, match.black_player);
      const white = side(match.white_player_id, match.white_player);
      if (isPlayer(black)) return {color: 'black', opponent: white};
      if (isPlayer(white)) return {color: 'white', opponent: black};
      const first = side(match.participant_1_id, match.participant_1);
      const second = side(match.participant_2_id, match.participant_2);
      if (isPlayer(first)) return {color: '', opponent: second};
      if (isPlayer(second)) return {color: '', opponent: first};
      return null;
    };
    const outcome = match => {
      const status = matchStatus(match);
      if (status === 'no_result') return {key: 'no_result', label: '无胜负', detail: ''};
      if (status === 'scheduled') return {key: 'scheduled', label: '待赛', detail: ''};
      if (status === 'pending') return {key: 'pending', label: '赛果待补', detail: ''};
      const winner = side(match.winner_id, match.winner);
      if (!winner.id && !winner.name) return {key: 'pending', label: '赛果待补', detail: ''};
      const won = isPlayer(winner);
      return {key: won ? 'win' : 'loss', label: won ? '胜' : '负',
        detail: winnerLabel(singleGamePresentation(match))};
    };
    // 与表格排序一致：完整日期优先，其次年／月精度；无法解析的日期排在末尾。
    const sortableDate = value => {
      const exact = dateKey(value);
      if (exact) return exact;
      const parts = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(String(value || '').trim());
      if (!parts) return '';
      return [parts[1], String(parts[2] || 0).padStart(2, '0'),
        String(parts[3] || 0).padStart(2, '0')].join('-');
    };

    const rows = [];
    const seen = new Set();
    for (const [editionId, data] of Object.entries(allData || {})) {
      if (!data || !Array.isArray(data.rounds)) continue;
      const meta = indexById.get(editionId) || {};
      const edition = data.edition || {};
      const tournament = data.tournament || {};
      const number = edition.edition_number != null ? edition.edition_number : meta.edition_number;
      const years = editionYearLabel(edition, meta.year);
      const editionMeta = [number != null && number !== '' ? `第${number}届` : '',
        years ? `${years}年` : ''].filter(Boolean).join(' · ');
      const tournamentName = tournament.short_name || meta.tournament_short
        || tournament.name_zh || meta.tournament_name || '';
      const year = Number(String(years).slice(0, 4)) || Number(edition.year ?? meta.year) || 0;
      const chronological = Number(edition.chronological_order ?? meta.seq ?? 0) || 0;
      for (const round of data.rounds) {
        for (const match of round?.matches || []) {
          if (!match || !match.id || seen.has(match.id)) continue;
          const person = appearance(match);
          if (!person) continue;
          seen.add(match.id);
          const date = String(match.date || '').trim();
          rows.push({
            id: match.id, editionId, date, dateKey: sortableDate(date),
            tournamentId: tournament.id || meta.tournament_id || '',
            category: tournament.category || meta.category || 'world',
            tournament: tournamentName, editionMeta, year, chronological,
            roundOrder: Number(round.round_order ?? 0) || 0,
            matchNumber: Number(match.match_number ?? 0) || 0,
            roundName: String(round.round_name || '').trim(),
            opponent: {
              id: person.opponent.id,
              name_zh: person.opponent.name,
              nationality: person.opponent.nationality,
            },
            color: person.color,
            outcome: outcome(match),
            hasSgf: Boolean(match.has_sgf || match.sgf?.present),
          });
        }
      }
    }
    const sort = options.sort === 'asc' ? 'asc' : 'desc';
    rows.sort((a, b) => comparePlayerGames(a, b, sort));
    return rows;
  }

  function matchesPlayerQuery(p, query, aliases = {}) {
    const q = String(query || '').normalize('NFKC').toLocaleLowerCase();
    return [p.id, p.name_zh, p.name_native, p.name_romanized, p.name_en, p.name_ko, p.name_ja,
      ...Object.keys(aliases.ids || {}).filter(id => aliases.ids[id] === p.id), ...(aliases.names?.[p.id] || [])]
      .some(n => n && String(n).normalize('NFKC').toLocaleLowerCase().includes(q));
  }
  function findPlayer(directory, query, aliases = {}) {
    const id = Object.hasOwn(aliases.ids || {}, query) ? aliases.ids[query] : query;
    const exact = directory.find(p => p.id === id);
    if (exact) return exact;
    const matches = directory.filter(p => p.name_zh === query || aliases.names?.[p.id]?.includes(query));
    return matches.length === 1 ? matches[0] : undefined;
  }
  function nativeNameHtml(p = {}) {
    const language = p.name_native_language || '语言待核';
    const pending = !p.name_native || /待核/.test(p.name_native_status || '待核');
    const value = p.name_native || '待核';
    const source = String(p.name_native_source || '');
    const link = /^https?:\/\/[^\s]+$/.test(source)
      ? ` <a class="profile-name-source" href="${escape(source)}" target="_blank" rel="noopener noreferrer">查看来源</a>` : '';
    const note = p.name_native_note ? `<div class="profile-name-note">${escape(p.name_native_note)}</div>` : '';
    const spelling = p.name_romanized && p.name_romanized !== p.name_native
      ? `<div class="profile-name-note">原记录国际拼写：${escape(p.name_romanized)}</div>` : '';
    return `<div class="profile-native-name"><span>原文姓名（${escape(language)}）：</span><strong>${escape(value)}</strong>${pending && p.name_native ? ' <span class="profile-name-note">（待核）</span>' : ''}${link}${spelling}${note}</div>`;
  }
  const api = {escape, raw, html, samePlayer, participants, formatRank, hasPlayer, dateKey, dateLabel, editionYearLabel, editionTitle, editionLabel, editionOngoing, editionChampionText, isMainOngoing, dateConflict, dateConflictInEdition, isPrelimRoundName, prelimRoundIds,
    isPrelimRound, isUnclassifiedRound, isLeagueRound, isGroupTableRound, prelimRegionOf, prelimGroups, prelimGroupOf, prelimGroupTree, prelimTreeGroups, PRELIM_REGION_ORDER, roundDisplayName,
    aggregateSeries, finalSeries, seriesOutcomes, seriesGameLabel, singleGamePresentation, isFinalRound, sourceRoundsForView, roundsForView, renderedMatches, edgesForView, unconfirmedLinks, collectPlayers, doubleEliminationLanes, doubleEliminationBlocks, extractGroupDoubleElimination,
    supportsStageDrawView, compareDrawMatches, groupRoundMatchesForDrawView,
    matchesPlayerQuery, findPlayer, comparePlayerGames, filterPlayerGames, playerGameRows, nativeNameHtml, isWorld, isCoreWorld, worldTier, isStrictEvent, WORLD_BOUNDARY_TOURNAMENTS, WORLD_TEAM_TOURNAMENTS, isTeamCompetition, isSingleGameFinal, editionFormatChip, categoryLabel, matchResult, winnerLabel, isNoResult, hasResult, bracketEdgesForView, editionPlayers, isGroupedPlayerLabel,
    matchStatus, statusLabel, STATUS_LABELS, hydrateSnapshot};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GoViewerModel = api;
})(typeof window === 'undefined' ? globalThis : window);
