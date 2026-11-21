/* 页面启动引导：统一处理 public（公开站）与 local-lazy（本地按需）两种模式。
 *
 * 约定：
 * - 全局数据对象在页面其余脚本加载前即保持稳定引用；
 * - `window.ALL_TOURNAMENTS_DATA` 只是“已载入届次缓存”，不承载整库快照；
 * - 本地 HTTP 请求 /api/page-data/bootstrap 获取棋手名录与全库统计；
 * - 公开站按页读取公开接口。
 */
(function (root) {
  'use strict';
  const client = root.GoStatsDataClient;
  const mode = (client && client.mode) || 'local-lazy';
  const isPublic = mode === 'public';
  const CATALOG_PAGE = 100;
  const FIXTURE_PRELOAD_LIMIT = 15;
  const hasLocalIndex = Array.isArray(root.TOURNAMENTS_INDEX);

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
    hasLocalIndex,
    version: null,
    stats: null,
    error: null,
    ready: Promise.resolve(),
    indexById: new Map(),
    indexItemFromEdition,
    mergeIndex,
  };

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
      domestic_country: null,
      competition_type: (data.podium_groups || []).length ? 'grouped'
        : (tournament.competition_type || 'individual'),
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

  async function startPublic() {
    try {
      const version = await client.version();
      boot.version = version;
      boot.stats = version.records || null;
      const first = await client.catalogPage(1, CATALOG_PAGE);
      mergeIndex(first.items);
      root.dispatchEvent(new CustomEvent('go-stats:catalog-page',
        {detail: {page: 1, page_meta: first.page}}));
      client.leaderboards().then(payload => {
        const ranking = root.CHAMPIONS_RANKING;
        ranking.splice(0, ranking.length,
          ...(payload.items || []).map(item => ({
            id: item.id, name: item.name, nationality: item.nationality,
            kiin: item.kiin, titles: item.titles,
          })));
        root.dispatchEvent(new CustomEvent('go-stats:leaderboards'));
      }).catch(() => {});
      client.catalogAllPages(CATALOG_PAGE, (items, meta) => {
        if (mergeIndex(items)) {
          root.dispatchEvent(new CustomEvent('go-stats:catalog-page',
            {detail: {page: meta.index, page_meta: meta}}));
        }
      }).catch(error => {
        root.dispatchEvent(new CustomEvent('go-stats:catalog-error',
          {detail: {error}}));
      });
    } catch (error) {
      boot.error = error;
      root.dispatchEvent(new CustomEvent('go-stats:boot-error', {detail: {error}}));
      throw error;
    }
  }

  async function startLocalLazy() {
    if (!hasLocalIndex) return;
    try {
      const urlParams = (() => {
        try { return new URLSearchParams((root.location && root.location.search) || ''); }
        catch (_) { return new URLSearchParams(); }
      })();
      const requestedEd = urlParams.get('ed');
      const isPlayerPage = /\/player\.html$/i.test((root.location && root.location.pathname) || '');
      const tasks = [client.bootstrap()];
      // 在 index 页面如果 URL 指定了届次，或小型测试夹具不超过 15 届，并行预热对应届次。
      if (!isPlayerPage) {
        if (root.TOURNAMENTS_INDEX.length > 0 && root.TOURNAMENTS_INDEX.length <= FIXTURE_PRELOAD_LIMIT) {
          for (const item of root.TOURNAMENTS_INDEX) {
            if (item && item.id) tasks.push(client.ensureEdition(item.id).catch(() => null));
          }
        } else if (requestedEd) {
          tasks.push(client.ensureEdition(requestedEd).catch(() => null));
        }
      }
      const [payload] = await Promise.all(tasks);
      if (payload) {
        boot.stats = payload.stats || null;
        boot.version = {data_version: payload.data_version || 'local', source: 'local', records: boot.stats};
        if (Array.isArray(payload.players)) {
          root.PLAYERS_DATA.splice(0, root.PLAYERS_DATA.length, ...payload.players);
        }
        if (payload.playerAliases) {
          Object.assign(root.PLAYER_ID_ALIASES, payload.playerAliases.ids || {});
          Object.assign(root.PLAYER_NAME_ALIASES, payload.playerAliases.names || {});
        }
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
