/* Read-only career matrix. Never backfill results or infer absence from missing records. */
(function (root) {
  'use strict';
  const M = typeof module !== 'undefined' && module.exports ? require('./viewer-model.js') : root.GoViewerModel;
  const TEAM_IDS = new Set(['nongshim', 'jinro', 'sbs_world', 'zhengguanzhuang']);
  const COUNTRY_LABELS = {CHN: '中国', KOR: '韩国', JPN: '日本', TWN: '中华台北'};
  const COUNTRY_ORDER = ['CHN', 'KOR', 'JPN', 'TWN'];
  const CHINA_EVENTS = new Set(
    'changqi ahan bosi cctv xiangyu_tv liguang daqishi jincheng nv_guoshou nv_mingren nv_mingshou qisheng tianyuan xinan xinrenwang lanke_cn wangzhongwang cwql cwwl guoshou_cn individual_cn jianqiao longxing_cn mingren_cn qiwang_cn rookie_open_cn zhoulanyu cwbl cwcl cwwbl new_pro_cn cn_duanwei'.split(' ')
  );
  const JP_TITLE_IDS = new Set([
    'jp_kisei', 'jp_meijin', 'jp_oza', 'jp_tengen', 'jp_gosei', 'jp_jyudan',
    'jp_fhoninbo', 'jp_fmeijin', 'jp_fkisei', 'jp_aidu'
  ]);
  const isJpTitleEvent = (tid, edNum) => JP_TITLE_IDS.has(tid) || (tid === 'jp_honinbo' && Number(edNum) <= 77);
  const isTeam = (data, meta) => TEAM_IDS.has(meta.tournament_id) || M.isTeamCompetition(data, meta);
  const isLeagueRound = round => /循环|循環|リーグ|积分编排/.test(round?.round_name || '');
  const winnerId = m => m.winner?.id || m.winner_id || m.series_winner_id;
  const has = (m, player) => M.hasPlayer(m, player) ||
    [m.black_player_id, m.white_player_id, m.participant_1_id, m.participant_2_id].includes(player.id);

  function tournamentCountry(meta = {}, data = null) {
    const category = meta.category || data?.tournament?.category || 'world';
    if (category !== 'domestic') return null;
    const rawExplicit = meta.domestic_country || data?.tournament?.domestic_country;
    const explicit = rawExplicit === 'TPE' ? 'TWN' : rawExplicit;
    if (explicit && COUNTRY_LABELS[explicit]) return explicit;
    const t = data?.tournament || {};
    const tid = meta.tournament_id || t.id || '';
    if (tid.startsWith('tw_') || tid === 'xinrenwang_tw') return 'TWN';
    if (tid.startsWith('jp_')) return 'JPN';
    if (tid.startsWith('kr_') || tid === 'kb') return 'KOR';
    if (tid.startsWith('cn_') || CHINA_EVENTS.has(tid)) return 'CHN';
    const name = meta.tournament_name || t.name_zh || '';
    const host = t.host_associations || '';
    if (/台湾|台灣/.test(name) || /海峰棋院|台湾棋院|台灣棋院|中華職業圍棋協會/.test(host)) return 'TWN';
    if (/^日本/.test(name) || /日本棋院|关西棋院|関西棋院/.test(host)) return 'JPN';
    if (/^韩国|^韓國/.test(name) || /韩国棋院|韓國棋院/.test(host)) return 'KOR';
    if (/^中国|^中國|^全国|^全國/.test(name) || /中国围棋协会|中國圍棋協會/.test(host)) return 'CHN';
    return null;
  }

  function kiinCountry(kiin) {
    const k = String(kiin || '').trim();
    if (!k) return null;
    if (/海峰棋院|台湾棋院|台灣棋院|中国围棋会|中國圍棋會|中華職業圍棋協會/.test(k)) return 'TWN';
    if (/日本棋院|关西棋院|関西棋院/.test(k)) return 'JPN';
    if (/韩国棋院|韓國棋院/.test(k)) return 'KOR';
    if (/中国围棋协会|中國圍棋協會/.test(k)) return 'CHN';
    return null;
  }

  function nationalityCountry(nat) {
    const n = String(nat || '').trim().toUpperCase();
    if (!n) return null;
    if (['CHN', 'CN', 'HKG', 'HK', '中国', '中國', '香港', '中国香港', '中國香港'].includes(n)) return 'CHN';
    if (['JPN', 'JP', '日本'].includes(n)) return 'JPN';
    if (['KOR', 'KR', '韩国', '韓國'].includes(n)) return 'KOR';
    if (['TPE', 'TWN', 'TW', '中华台北', '中華台北', '中国台北', '中國台北', '台湾', '台灣', '臺灣'].includes(n)) return 'TWN';
    return null;
  }

  function stageLabel(round, data, meta) {
    const name = String(round.round_name || '');
    const tid = meta?.tournament_id || data?.tournament?.id || '';
    const edNum = meta?.edition_number ?? data?.edition?.edition_number;
    if ((!isLeagueRound(round) && /挑战者决定|挑戰者決定|挑戦者決定/.test(name))
      || (isJpTitleEvent(tid, edNum) && /^本戦(?:トーナメント)?[｜|]決勝$/.test(name))) {
      return {label: '挑决', size: 3, turn: 0};
    }
    if (M.isFinalRound(round)) return {label: '决赛', size: 2, turn: 0};
    if (/半决赛|準決勝|准决赛/.test(name)) return {label: '4强', size: 4, turn: 0};
    if (/準々決勝/.test(name)) return {label: '8强', size: 8, turn: 0};
    const size = /(\d+)\s*[强強]/.exec(name);
    if (size) return {label: `${size[1]}强`, size: Number(size[1]), turn: 0};
    if (/循环圈|循環圈/.test(name)) return {label: '循环圈', size: null, turn: 0};
    const turn = /第\s*(\d+)\s*[轮輪]|(\d+)\s*回戦/.exec(name);
    if (turn) {
      const num = Number(turn[1] || turn[2]);
      return {label: `第${num}轮`, size: null, turn: num};
    }
    return {label: '本赛', size: null, turn: 0};
  }

  function editionResult(meta, data, player, today) {
    data = data || {edition: meta, rounds: [], tournament: {}};
    const edition = data.edition || meta;
    const team = isTeam(data, meta);
    const rounds = data.rounds || [];
    const entries = rounds.flatMap(round => (round.matches || []).filter(m => has(m, player)).map(match => ({round, match})));
    const main = entries.filter(e => !M.isPrelimRound(e.round) && (team || !M.isUnclassifiedRound(e.round)));
    const prelim = entries.filter(e => M.isPrelimRound(e.round));
    const podium = team ? null : [
      ['champion', 'champion_id', '冠军', 'champion'], ['runner_up', 'runner_up_id', '亚军', 'runner'],
      ['third_place', 'third_place_id', '季军', 'third'], ['fourth_place', 'fourth_place_id', '殿军', 'fourth']
    ].find(([key, field]) => (data[key]?.id || edition[field] || meta[field]) === player.id);
    let groupPodium = null;
    if (!team && !podium && Array.isArray(data.podium_groups)) {
      for (const g of data.podium_groups) {
        if ((g.champion?.id || g.champion_id) === player.id) {
          groupPodium = {label: '冠军', tone: 'champion', groupLabel: g.group_label || g.group_key || ''};
          break;
        }
        if ((g.runner_up?.id || g.runner_up_id) === player.id) {
          groupPodium = {label: '亚军', tone: 'runner', groupLabel: g.group_label || g.group_key || ''};
          break;
        }
      }
    }
    const roster = (data.roster || []).some(p => p.id === player.id);
    if (!entries.length && !podium && !groupPodium && !roster) return null;
    const champion = data.champion?.id || edition.champion_id || meta.champion_id || data.team_competition?.champion?.id
      || (data.podium_groups || []).some(g => g.champion?.id || g.champion_id);
    const ongoing = !champion && (['ongoing', '进行中'].includes(edition.status) ||
      String(edition.end_date || edition.start_date || '') > today ||
      rounds.some(r => (r.matches || []).some(m => M.matchStatus(m) === 'scheduled')));
    const games = [...new Map(main.map(e => [e.match.id, e.match])).values()];
    const wins = games.filter(m => !M.isNoResult(m) && winnerId(m) === player.id).length;
    const losses = games.filter(m => !M.isNoResult(m) && winnerId(m) && winnerId(m) !== player.id).length;
    const noResults = games.filter(M.isNoResult).length;
    const pending = games.filter(m => !M.hasResult(m) && !winnerId(m)).length;
    let label, tone = '', size = null, detail = '';
    if (team && games.length) {
      label = `${wins}:${losses}`;
      detail = `战绩：${wins}胜${losses}负${noResults ? `，${noResults}局无胜负` : ''}${pending ? `，${pending}局未决` : ''}`;
    } else if (podium) {
      label = podium[2]; tone = podium[3];
      detail = '已确认名次';
    } else if (groupPodium) {
      label = groupPodium.label; tone = groupPodium.tone;
      detail = groupPodium.groupLabel ? `${groupPodium.groupLabel}组名次` : '分组名次';
    } else if (main.length) {
      const staged = main.filter(e => !/季军|季軍|三四名|三、四名|三位|3位/.test(e.round.round_name || ''));
      // Use the furthest explicit stage, not dates or counts of incomplete brackets.
      const withStage = staged.map(e => ({...e, stage: stageLabel(e.round, data, meta)}));
      const sized = withStage.filter(e => e.stage.size);
      const last = sized.length ? sized.sort((a, b) => a.stage.size - b.stage.size)[0]
        : withStage.slice().sort((a, b) => (b.stage.turn || 0) - (a.stage.turn || 0) || Number(b.round.round_order) - Number(a.round.round_order))[0];
      const stage = last ? last.stage : {label: '本赛', size: null, turn: 0};
      size = stage.size; label = stage.label;
      if (size === 4) tone = 'fourth';
      const latest = last ? games.filter(m => main.some(e => e.match === m && stageLabel(e.round, data, meta).label === stage.label)) : [];
      if (latest.length && latest.every(M.isNoResult)) { label = '无胜负'; tone = ''; }
      else if (pending && latest.some(m => !M.hasResult(m))) label += '·待定';
      else if (latest.length && latest.every(m => winnerId(m) === player.id)) label += size === 2 ? '·待定' : '·晋级';
      detail = '按本赛轮次显示';
    } else if (prelim.length) {
      label = '预选'; detail = '仅预选赛记录';
    } else {
      label = entries.length ? '赛段待核' : '已报名'; detail = '暂无正赛成绩';
    }
    // Italics require completed, decisive games and an actual loss. A missing
    // result, a no-result game, or a summary-only title is never a zero-win exit.
    const zeroWins = !podium && !groupPodium && !team && !!size && wins === 0 && losses > 0 && pending === 0 && noResults === 0 &&
      games.every(m => !m.series_score && !m.isSeries);
    const exclusions = (data.review_exclusions || []).filter(e => (e.status === 'locked' || e.exclude_from_correction) &&
      (podium || groupPodium || entries.some(({round, match}) => (e.round_ids || []).includes(round.id) || (e.match_ids || []).includes(match.id))));
    const preserved = exclusions.length ? '用户指定保留，排除纠错' : '';
    return {editionId: meta.id, year: Number(meta.year), label, tone, ongoing, zeroWins, team,
      detail: [detail, noResults && !team ? `${noResults}局无胜负` : '', preserved, edition.finals_score && (podium || groupPodium) ? `决赛 ${edition.finals_score}` : ''].filter(Boolean).join('；')};
  }

  function resolveDomestic(index, allData, player, today = new Date().toISOString().slice(0, 10)) {
    const counts = {CHN: 0, KOR: 0, JPN: 0, TWN: 0};
    for (const meta of index || []) {
      const data = allData ? allData[meta.id] : null;
      const country = tournamentCountry(meta, data);
      if (!country) continue;
      if (editionResult(meta, data, player, today)) counts[country] += 1;
    }
    const kc = kiinCountry(player?.default_kiin);
    const nc = nationalityCountry(player?.nationality);
    const ranked = COUNTRY_ORDER.filter(code => counts[code] > 0)
      .sort((a, b) => counts[b] - counts[a] || COUNTRY_ORDER.indexOf(a) - COUNTRY_ORDER.indexOf(b));
    let primaryCountry = null;
    if (kc && counts[kc] > 0) primaryCountry = kc;
    else if (nc && counts[nc] > 0) primaryCountry = nc;
    else if (ranked.length) primaryCountry = ranked[0];
    else primaryCountry = kc || nc || 'CHN';
    const countries = [{code: primaryCountry, label: COUNTRY_LABELS[primaryCountry], count: counts[primaryCountry] || 0}];
    for (const code of ranked) {
      if (code !== primaryCountry) {
        countries.push({code, label: COUNTRY_LABELS[code], count: counts[code]});
      }
    }
    return {
      primaryCountry,
      primaryLabel: COUNTRY_LABELS[primaryCountry],
      countries,
    };
  }

  function build(index, allData, player, {category = 'all', country = null, today = new Date().toISOString().slice(0, 10)} = {}) {
    let eligible;
    let resolvedCountry = null;
    if (category === 'domestic') {
      resolvedCountry = country || resolveDomestic(index, allData, player, today).primaryCountry;
      eligible = (index || []).filter(e => {
        const data = allData ? allData[e.id] : null;
        if ((e.category || data?.tournament?.category || 'world') !== 'domestic') return false;
        const ec = tournamentCountry(e, data);
        return !ec || ec === resolvedCountry;
      });
    } else {
      eligible = (index || []).filter(e => ['world', 'women_world', 'international'].includes(e.category || 'world') &&
        (category === 'all' || (e.category || 'world') === category));
    }
    const results = new Map();
    for (const meta of eligible) {
      const result = editionResult(meta, allData[meta.id], player, today);
      if (result) results.set(meta.id, result);
    }
    const yearsFound = [...results.values()].map(r => r.year).filter(y => Number.isInteger(y) && y > 0);
    if (!yearsFound.length) return {years: [], rows: [], results: [...results.values()], country: resolvedCountry};
    const start = Math.min(...yearsFound), end = Math.max(...yearsFound);
    const years = Array.from({length: end - start + 1}, (_, i) => start + i);
    const tournamentIds = new Set(eligible.filter(e => results.has(e.id)).map(e => e.tournament_id));
    const rows = [...tournamentIds].map(id => {
      const editions = eligible.filter(e => e.tournament_id === id);
      const cells = years.map(year => ({year, editions: editions.filter(e => Number(e.year) === year).map(e => ({
        meta: e, result: results.get(e.id) || null
      }))}));
      return {id, name: editions[0].tournament_short || editions[0].tournament_name, category: editions[0].category || 'world', cells};
    });
    return {years, rows, results: [...results.values()], country: resolvedCountry};
  }

  const api = {
    build,
    editionResult,
    tournamentCountry,
    resolveDomestic,
    countryLabel: code => COUNTRY_LABELS[code] || ''
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GoViewerCareer = api;
})(typeof window === 'undefined' ? globalThis : window);
