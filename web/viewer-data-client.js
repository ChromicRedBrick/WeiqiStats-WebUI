/* 统一数据访问层：本地按需与公开按需共用一套异步契约。
 *
 * - local-lazy（本地 HTTP）：读取 /api/page-data/* 按需加载届次与表格检索；
 * - public：请求 /api/v1/*，按届次、轮次、检索、棋手、棋谱按需读取。
 *
 * 目录索引来自 data/tournaments_index.js；届次数据按需读取并以
 * window.ALL_TOURNAMENTS_DATA 作为“已载入届次缓存”（不再是整库快照）。
 * 约定：所有方法返回 Promise；失败抛出带可读消息的 Error；同一届次的并发请求
 * 合并为一次；赛事缓存上限 10 届或 30 MiB（先到者为准）；数据版本变化时派发
 * go-stats:version-changed，调用方据此提示刷新。
 */
(function (root) {
  'use strict';
  const PUBLIC = root.GO_STATS_DATA_MODE === 'public';
  const MODE = PUBLIC ? 'public' : 'local-lazy';
  const API = '/api/v1';
  const LOCAL_PAGE_API = '/api/page-data';
  const MAX_EDITIONS = 10;
  const MAX_EDITION_BYTES = 30 * 1024 * 1024;
  const ROSTER_PAGE = 100;
  const ROUND_PAGE = 100;

  const state = {
    version: null,
    inflight: new Map(),
    editions: new Map(),
    editionBytes: 0,
    catalogPages: new Map(),
    catalogMeta: null,
    bootstrapPromise: null,
  };

  function dataVersion(payload) {
    return payload && payload.data_version ? String(payload.data_version) : null;
  }

  function noteVersion(payload) {
    const version = dataVersion(payload);
    if (!version) return;
    if (!state.version) { state.version = version; return; }
    if (state.version !== version) {
      const previous = state.version;
      state.version = version;
      root.dispatchEvent(new CustomEvent('go-stats:version-changed',
        {detail: {previous, version}}));
    }
  }

  function query(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
      if (value === undefined || value === null || value === '') continue;
      search.set(key, String(value));
    }
    const text = search.toString();
    return text ? '?' + text : '';
  }

  async function request(path, params, options) {
    const url = API + path + query(params);
    const init = {headers: {Accept: 'application/json'}, cache: 'no-store'};
    const controller = options && options.controller;
    if (controller) init.signal = controller.signal;
    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      throw new Error('无法连接公开资料服务，请稍后重试。');
    }
    let payload = null;
    try { payload = await response.json(); } catch (_) { payload = null; }
    if (!response.ok) {
      const message = payload && payload.error ? payload.error : 'HTTP ' + response.status;
      const failure = new Error(message);
      failure.status = response.status;
      throw failure;
    }
    noteVersion(payload);
    return payload;
  }

  function editionSize(data) {
    try { return JSON.stringify(data).length; } catch (_) { return 0; }
  }

  function rememberEdition(id, data) {
    if (!id || !data) return;
    // 页内缓存与 window.ALL_TOURNAMENTS_DATA 保持同一份已载入届次数据。
    if (root.ALL_TOURNAMENTS_DATA) {
      root.ALL_TOURNAMENTS_DATA[id] = data;
    }
    const existing = state.editions.get(id);
    if (existing) {
      state.editionBytes -= existing.size;
      state.editions.delete(id);
    }
    const size = editionSize(data);
    if (size > MAX_EDITION_BYTES) return;           // 超大单届不进缓存
    state.editions.set(id, {data, size});
    state.editionBytes += size;
    while (state.editions.size > MAX_EDITIONS || state.editionBytes > MAX_EDITION_BYTES) {
      const oldest = state.editions.keys().next().value;
      if (oldest === undefined) break;
      state.editionBytes -= state.editions.get(oldest).size;
      state.editions.delete(oldest);
      if (oldest !== id && root.ALL_TOURNAMENTS_DATA) {
        delete root.ALL_TOURNAMENTS_DATA[oldest];
      }
    }
  }

  function invalidateEdition(id) {
    if (!id) return;
    const existing = state.editions.get(id);
    if (existing) {
      state.editionBytes -= existing.size;
      state.editions.delete(id);
    }
    state.inflight.delete(id);
    if (root.ALL_TOURNAMENTS_DATA) {
      delete root.ALL_TOURNAMENTS_DATA[id];
    }
  }

  function invalidateAllEditions() {
    state.editions.clear();
    state.editionBytes = 0;
    state.inflight.clear();
  }

  // 兼容层：既有页面模块仍按本地接口书写（/api/head-to-head、/api/ratings/...）。
  // 公开模式下把已确认同口径的只读路径映射到 /api/v1/，避免逐文件改路径；
  // 未确认口径的旧接口（如棋谱编辑、历史、草稿）保持原样，由服务端 404 拒绝。
  const LEGACY_PATHS = {
    '/api/head-to-head': '/api/v1/head-to-head',
    '/api/head-to-head/players': '/api/v1/head-to-head/players',
    '/api/head-to-head/opponents': '/api/v1/head-to-head/opponents',
    '/api/ratings/player-archive': '/api/v1/ratings/player-archive',
  };
  function legacySgfPayload(payload) {
    const match = payload.match || {};
    const meta = (payload.sgf && payload.sgf.meta) || null;
    const tree = payload.sgf && payload.sgf.tree;
    const label = [match.tournament_short,
      match.edition_number ? ('第' + match.edition_number + '届') : '',
      match.round_name].filter(Boolean).join(' ');
    const legacyMatch = {
      id: match.id,
      label,
      tournament: match.tournament_name,
      short_name: match.tournament_short,
      edition_number: match.edition_number,
      round_name: match.round_name,
      date: match.date,
      color_known: !!(match.black_player_id && match.white_player_id),
      black_id: match.black_player_id,
      white_id: match.white_player_id,
      black: (match.black_player || {}).name_zh,
      white: (match.white_player || {}).name_zh,
      result_type: match.result_type,
      result_detail: match.result_detail,
      winner_id: match.winner_id,
      match_number: match.match_number,
    };
    const sgf = tree && meta ? {
      id: meta.id,
      filename: null,
      byte_size: meta.byte_size,
      content_sha256: meta.content_sha256,
      encoding: meta.encoding,
      board_size: meta.board_size,
      meta: {
        komi: meta.komi, rules: meta.rules, handicap: meta.handicap,
        black_name: meta.black_name, white_name: meta.white_name,
        date: meta.game_date, result: meta.result,
      },
      stats: {main_line_moves: meta.main_line_moves, node_count: meta.node_count},
      warnings: [],
      parse_status: meta.parse_status,
      parser: {name: meta.parser_name, version: meta.parser_version},
      unsupported_properties: [],
      unknown_properties: [],
      game_fingerprint_sha256: meta.game_fingerprint_sha256,
      game_signature_version: meta.game_signature_version,
      game_has_moves: !!meta.game_has_moves,
      is_current: true,
      source_url: null,
      tree,
    } : null;
    return {
      match: legacyMatch,
      protected: payload.protection || {locked: false},
      can_write: false,
      link_revision: null,
      previous: null,
      versions: [],
      current_version_id: meta ? meta.id : null,
      browsing_version_id: meta ? meta.id : null,
      comparison: null,
      sgf,
    };
  }

  if (PUBLIC && typeof root.fetch === 'function') {
    const nativeFetch = root.fetch.bind(root);
    root.fetch = function (input, init) {
      try {
        const raw = typeof input === 'string' ? input
          : (typeof URL !== 'undefined' && input instanceof URL) ? input.href
          : (input && input.url) || '';
        const url = new URL(raw, root.location.href);
        if (url.origin === root.location.origin &&
            Object.prototype.hasOwnProperty.call(LEGACY_PATHS, url.pathname)) {
          url.pathname = LEGACY_PATHS[url.pathname];
          return nativeFetch(url.toString(), init);
        }
        const method = ((init && init.method) || 'GET').toUpperCase();
        const sgfMatch = method === 'GET' && url.pathname.match(/^\/api\/sgf\/match\/([A-Za-z0-9_\-]+)$/);
        const sgfVersion = method === 'GET' && url.pathname.match(
          /^\/api\/sgf\/version\/([A-Za-z0-9_\-]+)\/([A-Za-z0-9_\-]+)$/);
        if (sgfMatch || sgfVersion) {
          const target = new URL('/api/v1/sgf/' +
            encodeURIComponent((sgfMatch || sgfVersion)[1]), root.location.href);
          target.searchParams.set('format', 'both');
          if (sgfVersion) target.searchParams.set('version', sgfVersion[2]);
          return nativeFetch(target.toString(), init).then(async response => {
            if (!response.ok) return response;
            let payload = null;
            try { payload = await response.json(); } catch (_) { return response; }
            return new Response(JSON.stringify(legacySgfPayload(payload)), {
              status: response.status,
              headers: {'Content-Type': 'application/json; charset=utf-8'},
            });
          });
        }
      } catch (_) { /* 非标准 URL 时按原样请求 */ }
      return nativeFetch(input, init);
    };
  }

  // ---------------------------------------------------------------- local
  // 目录索引随页面加载（data/tournaments_index.js），按页切片即可；届次数据
  // 一律按需读取，本地模式没有整库内存快照。
  const local = {
    catalogPage(page, size) {
      const index = root.TOURNAMENTS_INDEX || [];
      const start = (page - 1) * size;
      return Promise.resolve({
        items: index.slice(start, start + size),
        page: {index: page, size, total: index.length,
               pages: Math.ceil(index.length / size), has_more: start + size < index.length},
      });
    },
  };

  // --------------------------------------------------------------- public
  function editionFromPayload(id, payload, roster) {
    return {
      tournament: payload.tournament || {},
      edition: payload.edition || {},
      champion: payload.champion || {},
      runner_up: payload.runner_up || {},
      third_place: payload.third_place || {},
      fourth_place: payload.fourth_place || {},
      podium_groups: payload.podium_groups || [],
      team_competition: payload.team_competition || null,
      league_rankings: payload.league_rankings || [],
      counts: payload.counts || {},
      rounds: (payload.rounds || []).map(round => ({
        id: round.id,
        edition_id: round.edition_id,
        round_order: round.round_order,
        round_name: round.round_name,
        date_range: round.date_range,
        location: round.location,
        schedule_note: round.schedule_note,
        matches: round.matches || [],
      })),
      roster: roster || [],
      __source: 'public',
      __edition_id: id,
    };
  }

  async function fetchRoundMatches(editionId, roundId, controller) {
    const matches = [];
    let page = 1;
    for (;;) {
      const payload = await request('/editions/' + encodeURIComponent(editionId) +
        '/rounds/' + encodeURIComponent(roundId),
        {page, page_size: ROUND_PAGE}, {controller});
      matches.push(...(payload.items || []));
      const meta = payload.page || {};
      if (!meta.has_more) break;
      page += 1;
      if (page > 200) break;                         // 防御：避免异常数据无限翻页
    }
    return matches;
  }

  async function fetchRoster(editionId, controller) {
    const roster = [];
    let page = 1;
    for (;;) {
      const payload = await request('/editions/' + encodeURIComponent(editionId),
        {part: 'roster', page, page_size: ROSTER_PAGE}, {controller});
      roster.push(...(payload.roster || []));
      const meta = payload.roster_page || {};
      if (!meta.has_more) break;
      page += 1;
      if (page > 40) break;
    }
    return roster;
  }

  async function fetchEdition(id) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const payload = await request('/editions/' + encodeURIComponent(id),
      {part: 'bracket'}, {controller});
    if (!payload) return null;
    if (payload.requires_round_fetch) {
      const rounds = payload.rounds || [];
      const loaded = [];
      const queue = rounds.slice();
      const workers = Array.from({length: Math.min(4, queue.length)}, async () => {
        while (queue.length) {
          const round = queue.shift();
          round.matches = await fetchRoundMatches(id, round.id, controller);
          loaded.push(round);
        }
      });
      await Promise.all(workers);
    }
    const roster = await fetchRoster(id, controller);
    return editionFromPayload(id, payload, roster);
  }

  const remote = {
    async catalogPage(page, size) {
      const key = page + ':' + size;
      if (state.catalogPages.has(key)) return state.catalogPages.get(key);
      const payload = await request('/catalog', {page, page_size: size});
      state.catalogPages.set(key, payload);
      return payload;
    },
    async catalogAllPages(size, onPage) {
      const first = await this.catalogPage(1, size);
      if (onPage) onPage(first.items || [], first.page || {});
      const total = (first.page && first.page.pages) || 1;
      for (let page = 2; page <= total; page += 1) {
        const payload = await this.catalogPage(page, size);
        if (onPage) onPage(payload.items || [], payload.page || {});
      }
    },
    ensureEdition(id) {
      if (!id) return Promise.resolve(null);
      const cached = state.editions.get(id);
      if (cached) {
        state.editions.delete(id);                   // LRU：最近使用移到队尾
        state.editions.set(id, cached);
        return Promise.resolve(cached.data);
      }
      if (state.inflight.has(id)) return state.inflight.get(id);
      const task = fetchEdition(id).then(data => {
        state.inflight.delete(id);
        if (data) rememberEdition(id, data);
        return data;
      }, error => {
        state.inflight.delete(id);
        throw error;
      });
      state.inflight.set(id, task);
      return task;
    },
    search(params) { return request('/matches', params); },
    searchCatalog(q) { return request('/catalog', {q, page_size: 6}); },
    player(id, params) { return request('/players/' + encodeURIComponent(id), params); },
    playerGames(id, filters) { return request('/players/' + encodeURIComponent(id) + '/games', filters); },
    searchPlayers(term, limit) {
      return request('/players', {q: term, page_size: limit || 20});
    },
    headToHead(params) { return request('/head-to-head', params); },
    ratingArchive(params) { return request('/ratings/player-archive', params); },
    monthlyRanking(params) { return request('/ratings/monthly', params); },
    sgf(matchId, format) {
      return request('/sgf/' + encodeURIComponent(matchId), {format: format || 'meta'});
    },
    leaderboards() { return request('/leaderboards', {}); },
    version() { return request('/version', {}); },
    stats() { return request('/version', {}).then(payload => payload.records || null); },
  };

  async function requestPageData(path, params, options) {
    const url = (path.startsWith('/api/') ? path : LOCAL_PAGE_API + path) + query(params);
    const init = {headers: {Accept: 'application/json'}, cache: 'no-store'};
    const controller = options && options.controller;
    if (controller) init.signal = controller.signal;
    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      throw new Error('无法连接本地资料服务，请确认查看器服务仍在运行。');
    }
    let payload = null;
    try { payload = await response.json(); } catch (_) { payload = null; }
    if (!response.ok) {
      const message = payload && payload.error ? payload.error : 'HTTP ' + response.status;
      const failure = new Error(message);
      failure.status = response.status;
      throw failure;
    }
    noteVersion(payload);
    return payload;
  }

  const localLazy = {
    catalogPage(page, size) {
      return local.catalogPage(page, size);
    },
    bootstrap() {
      if (!state.bootstrapPromise) {
        state.bootstrapPromise = requestPageData('/bootstrap', {}).catch(error => {
          state.bootstrapPromise = null;
          throw error;
        });
      }
      return state.bootstrapPromise;
    },
    ensureEdition(id) {
      if (!id) return Promise.resolve(null);
      const cached = state.editions.get(id);
      if (cached) {
        state.editions.delete(id);
        state.editions.set(id, cached);
        if (root.ALL_TOURNAMENTS_DATA) root.ALL_TOURNAMENTS_DATA[id] = cached.data;
        return Promise.resolve(cached.data);
      }
      if (root.ALL_TOURNAMENTS_DATA && root.ALL_TOURNAMENTS_DATA[id]) {
        const existing = root.ALL_TOURNAMENTS_DATA[id];
        rememberEdition(id, existing);
        return Promise.resolve(existing);
      }
      if (state.inflight.has(id)) return state.inflight.get(id);
      const task = requestPageData('/editions/' + encodeURIComponent(id), {}).then(data => {
        state.inflight.delete(id);
        if (data) rememberEdition(id, data);
        return data;
      }, error => {
        state.inflight.delete(id);
        throw error;
      });
      state.inflight.set(id, task);
      return task;
    },
    search(params) { return requestPageData('/matches', params); },
    searchCatalog(q) { return requestPageData('/catalog', {q}); },
    playerCareer(id, includeCatalog) { return requestPageData('/player-career', {id, catalog: includeCatalog ? '1' : undefined}); },
    player(id) { return requestPageData('/player-profile', {id}); },
    playerGames(id, filters) { return requestPageData('/player-games', {id, ...filters}); },
    searchPlayers(q, limit) { return requestPageData('/api/head-to-head/players', {q, limit}); },
    version() {
      return this.bootstrap().then(payload => ({
        data_version: payload.data_version || 'local',
        source: 'local',
        records: payload.stats || null,
      }));
    },
    stats() { return this.bootstrap().then(payload => payload.stats || null); },
  };

  const backend = MODE === 'public' ? remote : localLazy;

  root.GoStatsDataClient = {
    mode: MODE,
    isPublic: PUBLIC,
    isLazy: true,
    get version() { return state.version; },
    cacheStats() {
      return {editions: state.editions.size, bytes: state.editionBytes,
              catalogPages: state.catalogPages.size};
    },
    rememberEdition,
    invalidateEdition,
    invalidateAllEditions,
    bootstrap: () => backend.bootstrap ? backend.bootstrap() : Promise.resolve(null),
    playerCareer: (id, includeCatalog) => backend.playerCareer ? backend.playerCareer(id, includeCatalog) : Promise.resolve(null),
    edition: id => backend.edition ? backend.edition(id) : backend.ensureEdition(id),
    ensureEdition: id => backend.ensureEdition ? backend.ensureEdition(id) : backend.edition(id),
    catalogPage: (page, size) => backend.catalogPage(page, size),
    catalogAllPages: (size, onPage) => backend.catalogAllPages
      ? backend.catalogAllPages(size, onPage) : Promise.resolve(),
    search: params => backend.search(params),
    searchCatalog: q => backend.searchCatalog(q),
    player: (id, params) => backend.player(id, params),
    playerGames: (id, filters) => backend.playerGames(id, filters),
    searchPlayers: (term, limit) => backend.searchPlayers(term, limit),
    headToHead: params => backend.headToHead(params),
    ratingArchive: params => backend.ratingArchive(params),
    monthlyRanking: params => backend.monthlyRanking(params),
    sgf: (matchId, format) => backend.sgf(matchId, format),
    leaderboards: () => backend.leaderboards(),
    version: () => backend.version(),
    stats: () => backend.stats(),
  };
})(window);
