/* 页面启动引导：统一处理 public（公开站）与 local-lazy（本地按需）两种模式。
 *
 * 约定：
 * - 全局数据对象在页面其余脚本加载前即保持稳定引用；
 * - `window.ALL_TOURNAMENTS_DATA` 只是“已载入届次缓存”，不承载整库快照；
 * - `window.TOURNAMENTS_INDEX` 仅保存已接触届次的元数据缓存（不再是全库 5 MB 索引）；
 * - 本地 HTTP 请求 /api/page-data/bootstrap 获取棋手名录、全库统计、默认届次与冠军榜；
 * - 公开站仅按需请求常用赛事、榜单、版本与当前届次，不拉取全量目录。
 */
(function (root) {
  'use strict';
  const client = root.GoStatsDataClient;
  const mode = (client && client.mode) || 'local-lazy';
  const isPublic = mode === 'public';

  root.ALL_TOURNAMENTS_DATA = root.ALL_TOURNAMENTS_DATA || {};
  root.TOURNAMENTS_INDEX = root.TOURNAMENTS_INDEX || [];
  root.PLAYERS_DATA = root.PLAYERS_DATA || [];
  root.CHAMPIONS_RANKING = root.CHAMPIONS_RANKING || [];
  root.PLAYER_ID_ALIASES = root.PLAYER_ID_ALIASES || {};
  root.PLAYER_NAME_ALIASES = root.PLAYER_NAME_ALIASES || {};

  // 公开包不加载编辑器脚本；浏览路径里对 GoViewerEditor 的调用必须有安全占位，
  // 否则渲染会在 editor 未定义时中断。本地模式不定义，保持真实编辑器行为。
  if (isPublic && !root.GoViewerEditor) {
    root.GoViewerEditor = {
      enabled: () => false,
      button: () => '',
      quick: () => '',
      metadata: () => ({}),
      open: () => {},
      embed: () => '',
      notify: () => {},
      saveDrawOrder: () => Promise.resolve({saved: false}),
      askConfirm: () => Promise.resolve(false),
    };
  }

  const boot = {
    mode,
    isPublic,
    isLazy: true,
    hasLocalIndex: false,
    version: null,
    stats: null,
    defaultEdition: null,
    featured: null,
    error: null,
    ready: Promise.resolve(),
    indexById: new Map(),
    indexItemFromEdition,
    mergeIndex,
    readFeaturedPreference,
  };

  function readFeaturedPreference() {
    try {
      const raw = root.localStorage && root.localStorage.getItem('go_featured_tournaments_v1');
      if (!raw) return {custom: false, ids: []};
      const parsed = JSON.parse(raw);
      if (parsed && parsed.custom && Array.isArray(parsed.ids)) {
        return {
          custom: true,
          ids: parsed.ids.filter(id => typeof id === 'string' && id),
        };
      }
    } catch (_) {}
    return {custom: false, ids: []};
  }

  function indexItemFromEdition(data) {
    const edition = data.edition || {};
    const tournament = data.tournament || {};
    const champion = data.champion || {};
    const runnerUp = data.runner_up || {};
    return {
      id: edition.id,
      tournament_id: tournament.id,
      tournament_short: tournament.short_name,
      tournament_name: tournament.name_zh,
      edition_number: edition.edition_number,
      seq: edition.chronological_order,
      year: edition.year,
      start_date: edition.start_date,
      end_date: edition.end_date,
      champion: champion.name_zh || '',
      champion_nat: champion.nationality || null,
      champion_id: champion.id || edition.champion_id || null,
      runner_up: runnerUp.name_zh || '',
      runner_up_nat: runnerUp.nationality || null,
      runner_up_id: runnerUp.id || edition.runner_up_id || null,
      finals_score: edition.finals_score,
      finals_type: edition.finals_type,
      bracket_size: edition.bracket_size,
      bye_count: edition.bye_count,
      rules: edition.rules,
      komi: edition.komi,
      time_limit: edition.time_limit,
      notes: edition.notes,
      category: tournament.category,
      status: tournament.status,
      domestic_country: null,
      competition_type: (data.podium_groups || []).length ? 'grouped'
        : (data.team_competition || tournament.competition_type === 'team' ? 'team' : 'individual'),
      match_count: (data.counts || {}).match_count,
      sgf_count: (data.counts || {}).sgf_count,
      __synthetic: true,
    };
  }

  function mergeIndex(items) {
    let added = 0;
    for (const item of items || []) {
      if (!item || !item.id) continue;
      const existing = boot.indexById.get(item.id);
      if (existing) {
        if (existing.__synthetic && !item.__synthetic) {
          const index = root.TOURNAMENTS_INDEX.indexOf(existing);
          if (index >= 0) root.TOURNAMENTS_INDEX[index] = item;
          boot.indexById.set(item.id, item);
        }
        continue;
      }
      boot.indexById.set(item.id, item);
      root.TOURNAMENTS_INDEX.push(item);
      added += 1;
    }
    return added;
  }

  function requestedEditionFromUrl() {
    try {
      return new URLSearchParams((root.location && root.location.search) || '').get('ed') || '';
    } catch (_) {
      return '';
    }
  }

  async function startPublic() {
    try {
      const requestedEd = requestedEditionFromUrl();
      const [version, featured, requestedData] = await Promise.all([
        client.version(),
        client.catalogFeatured(readFeaturedPreference()),
        requestedEd ? client.ensureEdition(requestedEd).catch(() => null) : Promise.resolve(null),
      ]);
      boot.version = version;
      boot.stats = version.records || null;
      boot.featured = featured || null;
      boot.defaultEdition = (featured && featured.default_edition) || null;
      if (boot.defaultEdition) mergeIndex([boot.defaultEdition]);
      if (requestedData) mergeIndex([indexItemFromEdition(requestedData)]);
      const activeTid = (requestedData && requestedData.tournament && requestedData.tournament.id)
        || (boot.defaultEdition && boot.defaultEdition.tournament_id);
      if (activeTid) {
        client.tournamentEditions(activeTid).catch(() => null);
      }
      client.leaderboards().then(payload => {
        const ranking = root.CHAMPIONS_RANKING;
        ranking.splice(0, ranking.length,
          ...(payload.items || []).map(item => ({
            id: item.id, name: item.name, nationality: item.nationality,
            kiin: item.kiin, titles: item.titles,
          })));
        root.dispatchEvent(new CustomEvent('go-stats:leaderboards'));
      }).catch(() => {});
    } catch (error) {
      boot.error = error;
      root.dispatchEvent(new CustomEvent('go-stats:boot-error', {detail: {error}}));
      throw error;
    }
  }

  async function startLocalLazy() {
    if (root.location && root.location.protocol === 'file:') return;
    try {
      const requestedEd = requestedEditionFromUrl();
      const isPlayerPage = /\/player\.html$/i.test((root.location && root.location.pathname) || '');
      const tasks = [
        client.bootstrap(),
        client.catalogFeatured(readFeaturedPreference()).catch(() => null),
      ];
      if (!isPlayerPage && requestedEd) {
        tasks.push(client.ensureEdition(requestedEd).catch(() => null));
      }
      const [payload, featured, requestedData] = await Promise.all(tasks);
      if (payload) {
        boot.hasLocalIndex = true;
        boot.stats = payload.stats || null;
        boot.version = {data_version: payload.data_version || 'local', source: 'local', records: boot.stats};
        boot.defaultEdition = payload.defaultEdition || (featured && featured.default_edition) || null;
        boot.featured = featured || null;
        if (boot.defaultEdition) mergeIndex([boot.defaultEdition]);
        if (requestedData) mergeIndex([indexItemFromEdition(requestedData)]);
        if (Array.isArray(payload.championsRanking)) {
          root.CHAMPIONS_RANKING.splice(0, root.CHAMPIONS_RANKING.length, ...payload.championsRanking);
        }
        if (Array.isArray(payload.players)) {
          root.PLAYERS_DATA.splice(0, root.PLAYERS_DATA.length, ...payload.players);
        }
        if (payload.playerAliases) {
          Object.assign(root.PLAYER_ID_ALIASES, payload.playerAliases.ids || {});
          Object.assign(root.PLAYER_NAME_ALIASES, payload.playerAliases.names || {});
        }
      }
      if (!isPlayerPage) {
        const targetEd = requestedEd || (boot.defaultEdition && boot.defaultEdition.id) || '';
        const targetTid = (requestedData && requestedData.tournament && requestedData.tournament.id)
          || (boot.defaultEdition && boot.defaultEdition.tournament_id) || '';
        const followups = [];
        if (!requestedEd && targetEd) {
          followups.push(client.ensureEdition(targetEd).catch(() => null));
        }
        if (targetTid) {
          followups.push(client.tournamentEditions(targetTid).catch(() => null));
        }
        if (followups.length) await Promise.all(followups);
      }
      root.dispatchEvent(new CustomEvent('go-stats:bootstrap-ready', {detail: payload || {}}));
    } catch (error) {
      boot.error = error;
      root.dispatchEvent(new CustomEvent('go-stats:boot-error', {detail: {error}}));
      throw error;
    }
  }

  if (mode === 'public') boot.ready = startPublic();
  else boot.ready = startLocalLazy();

  root.GoStatsBoot = boot;
})(window);
