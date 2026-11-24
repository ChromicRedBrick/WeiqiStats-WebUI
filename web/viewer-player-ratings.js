/* 棋手独立资料页 · 等级分档案模块（只读）。
 *
 * 公开接口：window.GoViewerPlayerRatings.mount(container, {playerId, playerName, onArchiveChange})
 * 返回实例：{destroy(), refresh(), load(), getState(), setAnnotations(items)}。
 *
 * 约定：
 * 1. 只调用 GET /api/ratings/player-archive（本地/公开经数据客户端兼容）；
 * 2. 摘要与图表由同一份档案响应驱动；viewer-ratings-chart.js 按需动态加载；
 * 3. 分值与排名合并为单图分段切换（分值 / 排名），不重复请求；
 * 4. 翻页、每页条数、包含排除项走 fields=items 局部更新明细表，不重建图表；
 * 5. URL 只读写 rating_* 参数，不覆盖人物 ID、交锋或战绩页的状态。
 */
(function () {
  'use strict';

  const DEFAULT_PAGE_SIZE = 25;
  const PAGE_SIZES = [25, 50, 100];
  const ALL_LABELS_KEY = 'go_player_chart_all_labels_v1';
  const URL_KEYS = {
    system: 'rating_system',
    from: 'rating_from',
    to: 'rating_to',
    page: 'rating_page',
    size: 'rating_size',
    excluded: 'rating_excluded',
    metric: 'rating_metric'
  };

  const instances = new WeakMap();
  let uidCounter = 0;
  let chartScriptPromise = null;

  function ensureChartScript() {
    if (window.GoViewerRatingsChart && typeof window.GoViewerRatingsChart.create === 'function') {
      return Promise.resolve(window.GoViewerRatingsChart);
    }
    if (chartScriptPromise) return chartScriptPromise;
    chartScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="viewer-ratings-chart.js"], script[src$="/viewer-ratings-chart.js"]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.GoViewerRatingsChart), {once: true});
        existing.addEventListener('error', () => reject(new Error('图表组件加载失败')), {once: true});
        return;
      }
      const script = document.createElement('script');
      script.src = 'viewer-ratings-chart.js';
      script.async = true;
      script.onload = () => resolve(window.GoViewerRatingsChart);
      script.onerror = () => {
        script.remove();
        chartScriptPromise = null;
        reject(new Error('图表组件加载失败'));
      };
      document.body.appendChild(script);
    });
    return chartScriptPromise;
  }

  const esc = value => String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const isNum = value => value !== null && value !== undefined && Number.isFinite(Number(value));
  const fmtRating = value => isNum(value) ? Number(value).toFixed(1) : '—';

  const fmtMonthKey = value => {
    if (!isNum(value)) return '—';
    const mk = Number(value);
    return `${Math.floor(mk / 100)}-${String(mk % 100).padStart(2, '0')}`;
  };

  function addMonths(monthKey, delta) {
    const year = Math.floor(monthKey / 100);
    const month = monthKey % 100;
    const index = year * 12 + (month - 1) + delta;
    const nextYear = Math.floor(index / 12);
    const nextMonth = index - nextYear * 12 + 1;
    return nextYear * 100 + nextMonth;
  }

  function monthDistance(from, to) {
    if (!isNum(from) || !isNum(to)) return 0;
    const a = Math.floor(from / 100) * 12 + (from % 100) - 1;
    const b = Math.floor(to / 100) * 12 + (to % 100) - 1;
    return b - a + 1;
  }

  function monthToIndex(mk) {
    return Math.floor(mk / 100) * 12 + (mk % 100) - 1;
  }

  function indexToMonth(idx) {
    const y = Math.floor(idx / 12);
    const m = idx - y * 12 + 1;
    return y * 100 + m;
  }

  function parseMonthParam(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!/^\d{6}$/.test(text)) return null;
    const month = Number(text.slice(4));
    return month >= 1 && month <= 12 ? Number(text) : null;
  }

  function parseMonthInput(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    return Number(match[1]) * 100 + month;
  }

  function monthInputValue(monthKey) {
    if (!isNum(monthKey)) return '';
    return fmtMonthKey(monthKey);
  }

  function currentTheme() {
    return document.body?.dataset?.theme === 'dark' ? 'dark' : 'light';
  }

  function readAllLabelsPref() {
    try { return localStorage.getItem(ALL_LABELS_KEY) === '1'; } catch (_) { return false; }
  }

  function readUrlState() {
    const params = new URLSearchParams(location.search);
    const rawPage = parseInt(params.get(URL_KEYS.page) || '1', 10);
    const rawSize = parseInt(params.get(URL_KEYS.size) || String(DEFAULT_PAGE_SIZE), 10);
    const rawMetric = params.get(URL_KEYS.metric);
    return {
      system: params.get(URL_KEYS.system) || null,
      from: parseMonthParam(params.get(URL_KEYS.from)),
      to: parseMonthParam(params.get(URL_KEYS.to)),
      page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
      pageSize: PAGE_SIZES.includes(rawSize) ? rawSize : DEFAULT_PAGE_SIZE,
      includeExcluded: ['1', 'true'].includes(String(params.get(URL_KEYS.excluded) || '').toLowerCase()),
      metric: rawMetric === 'rank' ? 'rank' : 'rating'
    };
  }

  function statusTone(status) {
    if (status === 'unavailable' || status === 'error') return 'error';
    if (['unlinked', 'pending', 'conflict', 'review_required', 'system_unlinked', 'no_records'].includes(status)) return 'empty';
    return 'ok';
  }

  const BADGE_TEXT = {
    unavailable: '数据表未初始化',
    unlinked: '身份未关联',
    pending: '身份待审核',
    review_required: '关联待核',
    conflict: '同名待核',
    system_unlinked: '该体系未关联',
    no_records: '暂无记录',
    ok: '已审核关联',
    loading: '读取中',
    error: '读取失败'
  };

  function createInstance(container, options) {
    const playerId = String(options.playerId || '').trim();
    const initialUrl = readUrlState();
    const state = {
      destroyed: false,
      started: false,
      loading: false,
      error: null,
      payload: null,
      system: initialUrl.system,
      from: initialUrl.from,
      to: initialUrl.to,
      preset: null,
      page: initialUrl.page,
      pageSize: initialUrl.pageSize,
      includeExcluded: initialUrl.includeExcluded,
      metric: initialUrl.metric,
      showAllLabels: readAllLabelsPref(),
      detailsOpen: initialUrl.page > 1 || initialUrl.includeExcluded,
      tableRendered: false,
      annotations: [],
      token: 0,
      controller: null,
      charts: [],
      io: null,
      themeObserver: null,
      clamped: false,
      theme: currentTheme()
    };

    const instance = {
      destroy,
      refresh: () => fetchArchive({fresh: true}),
      load: start,
      getState: () => state,
      setAnnotations(items) {
        state.annotations = Array.isArray(items) ? items : [];
        if (state.payload && state.payload.status === 'ok' && state.charts.length && state.metric === 'rating') {
          renderCharts(state.payload);
        }
      }
    };

    container.innerHTML = '';
    container.dataset.playerRatingsMounted = '1';
    const shell = document.createElement('div');
    shell.className = 'player-ratings-shell';
    shell.setAttribute('data-player-ratings', '1');
    shell.dataset.ratingsState = 'idle';
    shell.innerHTML = `
      <div class="player-ratings-head">
        <div>
          <h2 id="playerRatingsTitle">等级分档案</h2>
        </div>
        <div class="player-ratings-head-actions">
          <a class="btn btn-sm player-ratings-workspace-link" data-ratings-workspace-link
             href="ratings.html?tab=trend" hidden>等级分工作区</a>
          <span class="player-ratings-badge" data-ratings-badge role="status" hidden></span>
        </div>
      </div>
      <div class="player-ratings-body" data-ratings-body aria-busy="true">
        <div class="player-skeleton-block" aria-hidden="true">
          <div class="skeleton-row"><span class="skeleton-pill"></span><span class="skeleton-pill"></span><span class="skeleton-pill"></span></div>
          <div class="skeleton-grid-4"><span class="skeleton-card"></span><span class="skeleton-card"></span><span class="skeleton-card"></span><span class="skeleton-card"></span></div>
          <div class="skeleton-chart"></div>
        </div>
      </div>`;
    container.appendChild(shell);

    const body = shell.querySelector('[data-ratings-body]');
    const badge = shell.querySelector('[data-ratings-badge]');
    const navLink = document.getElementById('playerRatingsNav');

    function isWorkspaceBackUrl(value) {
      try {
        const url = new URL(value, location.href);
        if (url.origin !== location.origin) return false;
        return /(^|\/)ratings\.html$/.test(url.pathname);
      } catch (_) {
        return false;
      }
    }

    function workspaceBackUrl() {
      const back = new URLSearchParams(location.search).get('back');
      return back && isWorkspaceBackUrl(back) ? back : '';
    }

    function workspacePlayerName(payload) {
      if (payload) {
        const playerName = payload.player && payload.player.name_zh;
        const selected = payload.selected_system || {};
        const system = (payload.available_systems || []).find(item => item.id === selected.id) || {};
        const names = system.player_names || [];
        if (playerName && names.includes(playerName)) return playerName;
        if (names.length) return names[0];
        if (playerName) return playerName;
      }
      return String(options.playerName || '').trim();
    }

    function workspaceHref(payload) {
      const back = workspaceBackUrl();
      if (back) return back;
      const url = new URL('ratings.html', location.href);
      url.searchParams.set('tab', 'trend');
      const system = state.system || (payload && payload.selected_system && payload.selected_system.id) || '';
      if (system) url.searchParams.set('system', system);
      const name = workspacePlayerName(payload);
      if (name) url.searchParams.set('players', name);
      return 'ratings.html' + url.search;
    }

    function syncWorkspaceLink(payload) {
      const link = shell.querySelector('[data-ratings-workspace-link]');
      if (!link) return;
      if (window.GoStatsDataClient && window.GoStatsDataClient.isPublic) {
        link.hidden = true;
        return;
      }
      link.hidden = false;
      link.href = workspaceHref(payload);
      link.title = workspaceBackUrl()
        ? '返回等级分工作区'
        : '在等级分工作区查看该棋手走势';
    }

    syncWorkspaceLink(null);

    function setBadge(text, tone, visible = true) {
      badge.textContent = text || '';
      badge.dataset.tone = tone || 'ok';
      badge.hidden = !visible;
    }

    function start() {
      if (state.destroyed || state.started) return;
      state.started = true;
      const urlState = readUrlState();
      applyUrlState(urlState);
      ensureChartScript().catch(() => null);
      fetchArchive();
    }

    function applyUrlState(urlState) {
      state.system = urlState.system;
      state.from = urlState.from;
      state.to = urlState.to;
      state.page = urlState.page;
      state.pageSize = urlState.pageSize;
      state.includeExcluded = urlState.includeExcluded;
      state.metric = urlState.metric || 'rating';
      state.preset = null;
      if (urlState.page > 1 || urlState.includeExcluded) state.detailsOpen = true;
    }

    function writeUrl(mode) {
      let url;
      try {
        url = new URL(location.href);
      } catch (_) {
        return;
      }
      const setOrDelete = (key, value) => {
        if (value === null || value === undefined || value === '') url.searchParams.delete(key);
        else url.searchParams.set(key, String(value));
      };
      setOrDelete(URL_KEYS.system, state.system);
      setOrDelete(URL_KEYS.from, state.from);
      setOrDelete(URL_KEYS.to, state.to);
      setOrDelete(URL_KEYS.page, state.page > 1 ? state.page : '');
      setOrDelete(URL_KEYS.size, state.pageSize !== DEFAULT_PAGE_SIZE ? state.pageSize : '');
      setOrDelete(URL_KEYS.excluded, state.includeExcluded ? '1' : '');
      setOrDelete(URL_KEYS.metric, state.metric === 'rank' ? 'rank' : '');
      try {
        if (mode === 'push') history.pushState({playerRatings: true}, '', url.href);
        else history.replaceState({playerRatings: true}, '', url.href);
      } catch (_) {}
    }

    function buildQueryObject(itemsOnly) {
      const params = {player_id: playerId};
      if (state.system) params.system = state.system;
      if (isNum(state.from)) params.from = String(state.from);
      if (isNum(state.to)) params.to = String(state.to);
      if (state.page > 1) params.page = String(state.page);
      if (state.pageSize !== DEFAULT_PAGE_SIZE) params.page_size = String(state.pageSize);
      if (state.includeExcluded) params.include_excluded = '1';
      if (itemsOnly) params.fields = 'items';
      return params;
    }

    async function requestArchivePayload(params, opts = {}) {
      const dataClient = window.GoStatsDataClient;
      if (dataClient && typeof dataClient.ratingArchive === 'function') {
        return dataClient.ratingArchive(params, {controller: state.controller, fresh: Boolean(opts.fresh)});
      }
      const url = new URL('api/ratings/player-archive', location.href);
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
      const response = await fetch(url, {
        headers: {Accept: 'application/json'},
        cache: 'no-store',
        signal: state.controller.signal
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error((payload && payload.error) || `HTTP ${response.status}`);
      }
      return payload;
    }

    async function fetchArchive(opts = {}) {
      if (state.destroyed) return;
      const itemsOnly = Boolean(opts.itemsOnly && state.payload && state.payload.status === 'ok');
      const token = ++state.token;
      if (state.controller) state.controller.abort();
      state.controller = new AbortController();
      state.loading = true;
      state.error = null;
      if (!state.payload) {
        shell.dataset.ratingsState = 'loading';
        body.setAttribute('aria-busy', 'true');
      }

      let payload = null;
      try {
        payload = await requestArchivePayload(buildQueryObject(itemsOnly), opts);
      } catch (error) {
        if (error.name === 'AbortError' || token !== state.token || state.destroyed) return;
        state.loading = false;
        body.removeAttribute('aria-busy');
        state.error = error.message || '网络请求失败';
        render();
        return;
      }
      if (token !== state.token || state.destroyed) return;
      body.removeAttribute('aria-busy');
      if (!payload || typeof payload !== 'object') {
        state.loading = false;
        state.error = '接口返回内容不是有效的档案数据。';
        render();
        return;
      }
      if (itemsOnly && state.payload) {
        applyItemsOnlyPayload(payload);
      } else {
        applyPayload(payload);
      }
    }

    function applyItemsOnlyPayload(payload) {
      state.loading = false;
      state.error = null;
      const nextPayload = {
        ...state.payload,
        items: payload.items || [],
        pagination: payload.pagination || state.payload.pagination,
        scope: (state.payload.scope && payload.scope)
          ? {...state.payload.scope, include_excluded: payload.scope.include_excluded}
          : state.payload.scope
      };
      state.payload = nextPayload;
      const pagination = state.payload.pagination || {};
      if (!state.clamped && state.page > 1 && pagination.pages > 0 && state.page > pagination.pages) {
        state.clamped = true;
        state.page = pagination.pages;
        fetchArchive({itemsOnly: true});
        return;
      }
      state.clamped = false;
      renderTableOnly(state.payload);
    }

    function applyPayload(payload) {
      state.payload = payload;
      state.loading = false;
      state.error = null;
      if (payload.selected_system && payload.selected_system.id) state.system = payload.selected_system.id;
      const isDateSystem = payload.selected_system && (payload.selected_system.time_scale === 'date' || payload.selected_system.id === 'goratings');
      if (payload.scope) {
        if (!isNum(state.from)) state.from = payload.scope.from;
        if (!isNum(state.to)) state.to = payload.scope.to;
        if (state.preset === null) {
          state.preset = payload.scope.default_range
            ? (isDateSystem ? 'all' : '36')
            : detectPreset(payload, state.from, state.to);
        }
      }
      const pagination = payload.pagination || {};
      if (!state.clamped && state.page > 1 && pagination.pages > 0 && state.page > pagination.pages) {
        state.clamped = true;
        state.page = pagination.pages;
        fetchArchive();
        return;
      }
      state.clamped = false;
      if (typeof options.onArchiveChange === 'function') {
        try { options.onArchiveChange(payload); } catch (_) {}
      }
      render();
    }

    function detectPreset(payload, from, to) {
      const bounds = systemBounds(payload, payload.selected_system && payload.selected_system.id);
      if (!isNum(from) || !isNum(to)) return '36';
      if (isNum(bounds.first) && isNum(bounds.last) && from === bounds.first && to === bounds.last) return 'all';
      if (isNum(bounds.last) && to === bounds.last) {
        const count = monthDistance(from, to);
        if (count === 12) return '12';
        if (count === 36) return '36';
      }
      return 'custom';
    }

    function systemBounds(payload, systemId) {
      const entry = (payload && payload.available_systems || []).find(item => item.id === systemId);
      return {
        first: entry ? entry.system_first_month : null,
        last: entry ? entry.system_last_month : null
      };
    }

    function presetRange(preset, systemId) {
      const payload = state.payload;
      const bounds = systemBounds(payload, systemId);
      if (!isNum(bounds.last)) return {from: null, to: null};
      if (preset === 'all') return {from: bounds.first, to: bounds.last};
      const span = preset === '12' ? 12 : 36;
      let from = addMonths(bounds.last, -(span - 1));
      if (isNum(bounds.first) && from < bounds.first) from = bounds.first;
      return {from, to: bounds.last};
    }

    function navigate(patch, navOptions) {
      const opts = navOptions || {};
      const systemChanged = 'system' in patch && patch.system !== state.system;
      const rangeChanged = ('from' in patch && patch.from !== state.from) || ('to' in patch && patch.to !== state.to);
      const pageChanged = ('page' in patch && patch.page !== state.page)
        || ('pageSize' in patch && patch.pageSize !== state.pageSize)
        || ('includeExcluded' in patch && patch.includeExcluded !== state.includeExcluded);
      const metricChanged = 'metric' in patch && patch.metric !== state.metric;
      if (!systemChanged && !rangeChanged && !pageChanged && !metricChanged) {
        return;
      }
      if ('system' in patch) state.system = patch.system;
      if ('from' in patch) state.from = patch.from;
      if ('to' in patch) state.to = patch.to;
      if ('preset' in patch) state.preset = patch.preset;
      if ('page' in patch) state.page = patch.page;
      if ('pageSize' in patch) state.pageSize = patch.pageSize;
      if ('includeExcluded' in patch) state.includeExcluded = patch.includeExcluded;
      if ('metric' in patch) state.metric = patch.metric;
      writeUrl(opts.push ? 'push' : 'replace');
      const itemsOnly = !systemChanged && !rangeChanged && pageChanged && Boolean(state.payload && state.payload.status === 'ok');
      fetchArchive({itemsOnly});
    }

    function render() {
      if (state.destroyed) return;
      destroyCharts();
      const payload = state.payload;
      syncWorkspaceLink(payload);
      if (state.error) {
        renderError();
        return;
      }
      if (!payload) {
        shell.dataset.ratingsState = 'loading';
        setBadge('', 'ok', false);
        return;
      }
      shell.dataset.ratingsState = payload.status || 'ok';
      if (payload.status === 'unavailable') {
        renderSimple('unavailable', payload.message || '暂无等级分数据。', payload);
        return;
      }
      if (['unlinked', 'pending', 'conflict', 'review_required', 'system_unlinked', 'no_records'].includes(payload.status)) {
        renderSimple(payload.status, messageForStatus(payload), payload);
        return;
      }
      renderArchive(payload);
    }

    function tabsHtml(payload) {
      const selected = payload.selected_system ? payload.selected_system.id : '';
      const systems = payload.available_systems || [];
      if (!systems.length) return '';
      const playerZh = (payload.player && payload.player.name_zh) || options.playerName || '';
      return `
        <div class="player-ratings-tabs" role="tablist" aria-label="等级分体系">
          ${systems.map(system => {
            const active = system.id === selected;
            const latestVal = system.linked && isNum(system.latest_rating) ? fmtRating(system.latest_rating) : '—';
            const altNames = (system.player_names || []).filter(n => n && n !== playerZh);
            const titleAttr = altNames.length ? `登记名：${altNames.join('、')}` : '';
            return `<button type="button" role="tab" class="player-ratings-tab" data-system="${esc(system.id)}"
              aria-selected="${active}" tabindex="${active ? 0 : -1}"${titleAttr ? ` title="${esc(titleAttr)}"` : ''}>
              <span>${esc(system.name)}</span>
              <small data-linked="${system.linked ? '1' : '0'}">${esc(latestVal)}</small>
            </button>`;
          }).join('')}
        </div>`;
    }

    function candidateHintHtml(payload) {
      if (window.GoStatsDataClient && window.GoStatsDataClient.isPublic) return '';
      const identity = payload.identity || {};
      const hint = identity.hint;
      if (payload.status === 'ok' || !hint || !hint.player_names || !hint.player_names.length) return '';
      const stateLabels = {pending: '待审核', conflict: '同名冲突', approved: '已审核'};
      const names = hint.player_names.map(name => `「${esc(name)}」`).join('、');
      const states = (hint.states || []).map(item => stateLabels[item] || item).join(' / ');
      return `<p class="player-ratings-hint">同名候选：${names}${states ? `（${esc(states)}）` : ''}。</p>`;
    }

    function messageForStatus(payload) {
      const isPublic = Boolean(window.GoStatsDataClient && window.GoStatsDataClient.isPublic);
      const identity = payload.identity || {};
      const systems = payload.available_systems || [];
      const selected = payload.selected_system || {};
      const systemName = selected.name || '所选';
      if (isPublic && ['unlinked', 'pending', 'conflict', 'review_required'].includes(payload.status)) {
        return '暂无等级分记录。';
      }
      switch (payload.status) {
        case 'unlinked':
          return '等级分身份尚未关联，暂无法展示记录。';
        case 'pending':
          return '等级分身份关联待审核，审核后即可查看记录。';
        case 'conflict':
          return '存在同名冲突，请在等级分工作区确认身份。';
        case 'review_required':
          return '关联信息待核，请到等级分工作区核对。';
        case 'system_unlinked': {
          const linked = systems.filter(item => item.linked).map(item => item.name).join('、');
          return `该棋手在${systemName}体系没有已审核的关联${linked ? `（已关联：${linked}）` : ''}。`;
        }
        case 'no_records':
          return `在${systemName}体系中尚未收录该棋手的等级分记录。`;
        default:
          return identity.link_state_label || '暂无等级分档案。';
      }
    }

    function renderSimple(status, message, payload) {
      const isPublic = Boolean(window.GoStatsDataClient && window.GoStatsDataClient.isPublic);
      if (isPublic && ['unlinked', 'pending', 'conflict', 'review_required'].includes(status)) {
        setBadge('', 'empty', false);
      } else {
        setBadge(BADGE_TEXT[status] || '未关联', statusTone(status), true);
      }
      const showRetry = status === 'unavailable';
      body.innerHTML = `
        ${tabsHtml(payload)}
        <div class="player-ratings-notice" data-ratings-message="${esc(status)}" role="status">
          <p>${esc(message)}</p>
          ${candidateHintHtml(payload)}
          ${payload && payload.status === 'no_records' && payload.coverage
            ? `<p class="player-ratings-meta">${esc((payload.selected_system || {}).name || '')}最新榜单：${esc(fmtMonthKey(payload.coverage.system.latest_month))}。</p>`
            : ''}
          ${showRetry ? '<button type="button" class="btn btn-sm" data-ratings-retry>重试</button>' : ''}
        </div>
      `;
      bindTabs();
      body.querySelector('[data-ratings-retry]')?.addEventListener('click', () => fetchArchive({fresh: true}));
    }

    function renderError() {
      setBadge(BADGE_TEXT.error, 'error', true);
      shell.dataset.ratingsState = 'error';
      body.innerHTML = `
        ${state.payload ? tabsHtml(state.payload) : ''}
        <div class="player-ratings-notice" data-ratings-error role="alert">
          <p>等级分档案读取失败，请稍后重试。</p>
          <button type="button" class="btn btn-sm" data-ratings-retry>重试</button>
        </div>`;
      bindTabs();
      body.querySelector('[data-ratings-retry]')?.addEventListener('click', () => fetchArchive({fresh: true}));
    }

    function summaryCards(payload) {
      const isDateSystem = payload.selected_system && (payload.selected_system.time_scale === 'date' || payload.selected_system.id === 'goratings');
      const summary = payload.all_time_summary || {};
      const latest = summary.latest_valid;
      const latestRecord = summary.latest_record;
      const peak = summary.peak_rating;
      const best = summary.best_rank;
      const latestRatingVal = latest ? (isNum(latest.rating) ? latest.rating : latest.public_rating) : null;
      const latestDateText = latest ? (latest.date || fmtMonthKey(latest.month_key)) : '—';
      const latestRecordProblem = latestRecord && latestRecord.status === 'conflict'
        ? '记录冲突'
        : '公示分无效';
      const latestNote = latest
        ? (latestRecord && latestRecord.month_key !== latest.month_key
          ? `最近有效 ${latestDateText}；最近记录 ${latestRecord.date || fmtMonthKey(latestRecord.month_key)} ${latestRecordProblem}`
          : latestDateText)
        : (latestRecord
          ? `最近记录 ${latestRecord.date || fmtMonthKey(latestRecord.month_key)} ${latestRecordProblem}`
          : '—');
      const rankText = latest && isNum(latest.rank) ? `第 ${latest.rank} 名` : '—';
      const peakList = peak ? (peak.dates || peak.month_strs || []) : [];
      const peakCount = peak ? (peak.count || peakList.length || 1) : 0;
      const peakFirstText = peak
        ? (peak.first_month ? fmtMonthKey(peak.first_month) : (peakList[0] || (peak.months && peak.months[0] ? fmtMonthKey(peak.months[0]) : '—')))
        : '';
      const bestList = best ? (best.dates || best.month_strs || []) : [];
      const bestCount = best ? (best.count || bestList.length || 1) : 0;
      const bestFirstText = best
        ? (best.first_month ? fmtMonthKey(best.first_month) : (bestList[0] || (best.months && best.months[0] ? fmtMonthKey(best.months[0]) : '—')))
        : '';
      const peakTitle = peakList.join('、');
      const bestTitle = bestList.join('、');
      const tieDetails = (list, count) => list && count > 1
        ? `<details class="player-ratings-tie"><summary>并列 ${count} 次</summary><p>${list.map(esc).join('、')}</p></details>`
        : '';
      return `
        <div class="player-ratings-summary" aria-label="等级分摘要">
          <div class="player-ratings-card" data-rating-card="latest">
            <span>${isDateSystem ? '最新估值' : '最新分'}</span>
            <strong>${esc(fmtRating(latestRatingVal))}</strong>
            <small>${esc(latestNote)}</small>
          </div>
          <div class="player-ratings-card" data-rating-card="rank">
            <span>排名</span>
            <strong>${esc(rankText)}</strong>
            <small>${esc(latestDateText)}</small>
          </div>
          <div class="player-ratings-card" data-rating-card="peak" title="${esc(peakTitle)}">
            <span>${isDateSystem ? '最高估值' : '最高分'}</span>
            <strong>${esc(peak ? fmtRating(peak.value) : '—')}</strong>
            <small>${esc(peak ? `${peakFirstText}${peakCount > 1 ? ` · 并列 ${peakCount} 次` : ''}` : '—')}</small>
            ${tieDetails(peakList, peakCount)}
          </div>
          <div class="player-ratings-card" data-rating-card="best" title="${esc(bestTitle)}">
            <span>最佳排名</span>
            <strong>${esc(best ? `第 ${best.value} 名` : '—')}</strong>
            <small>${esc(best ? `${bestFirstText}${bestCount > 1 ? ` · 共 ${bestCount} 次` : ''}` : '—')}</small>
            ${tieDetails(bestList, bestCount)}
          </div>
        </div>`;
    }

    function coverageHtml(payload) {
      const isDateSystem = payload.selected_system && (payload.selected_system.time_scale === 'date' || payload.selected_system.id === 'goratings');
      const coverage = payload.coverage || {};
      const system = coverage.system || {};
      const player = coverage.player || {};
      const scope = coverage.scope || {};
      const all = coverage.all_time || {};
      const scopeRange = payload.scope || {};

      const headline = isDateSystem
        ? `${player.first_date || fmtMonthKey(player.first_month)} 至 ${player.last_date || fmtMonthKey(player.last_month)} · ${player.record_count || 0} 条`
        : `最新榜单 ${fmtMonthKey(system.latest_month)} · ${player.record_count || 0} 条`;

      const detailLines = [];
      if (isDateSystem) {
        detailLines.push(`${payload.selected_system.name}共 ${system.month_count || 0} 期快照（最新 ${fmtMonthKey(system.latest_month)}），${player.month_count || 0} 个对局日。`);
        if (payload.selected_system?.methodology_note) {
          detailLines.push(payload.selected_system.methodology_note);
        }
        if (scopeRange.from_display && scopeRange.to_display) {
          detailLines.push(`所选区间 ${scopeRange.from_display} 至 ${scopeRange.to_display}：${scope.valid_months || 0} 个节点。`);
        }
      } else {
        detailLines.push(`最近记录：${fmtMonthKey(player.latest_month)}；有效 ${all.valid_rating_records || 0} 条（${player.month_count || 0} 个月）。`);
        if (isNum(system.latest_month) && isNum(player.latest_month) && player.latest_month < system.latest_month) {
          detailLines.push(`最新榜单未收录此人；最近记录为 ${fmtMonthKey(player.latest_month)}。`);
        }
        if (scopeRange.from_display && scopeRange.to_display) {
          detailLines.push(`所选区间 ${scopeRange.from_display}—${scopeRange.to_display}：有效 ${scope.valid_months || 0} 个月，缺榜 ${scope.system_missing_months || 0}，未收录 ${scope.player_missing_months || 0}，无效 ${scope.invalid_rating_months || 0}，冲突 ${scope.conflict_months || 0}。`);
        }
      }
      if ((all.invalid_rating_records || 0) + (all.conflict_records || 0) > 0) {
        detailLines.push(`已排除无效 ${all.invalid_rating_records || 0} 条、冲突 ${all.conflict_records || 0} 条。`);
      }

      const warn = (all.valid_rating_records || 0) === 0
        ? ((all.conflict_records || 0) > 0
          ? '<span class="player-ratings-warn">记录均存在冲突，暂未生成曲线。</span>'
          : '<span class="player-ratings-warn">暂无有效公示分，未生成曲线。</span>')
        : '';

      return `
        <div class="player-ratings-coverage-bar" data-ratings-coverage>
          <span class="player-ratings-coverage-line">${esc(headline)}</span>
          ${warn}
          <details class="player-ratings-coverage-more" data-ratings-coverage-details>
            <summary>数据说明</summary>
            <div class="player-ratings-coverage-detail">${detailLines.map(l => `<p>${esc(l)}</p>`).join('')}</div>
          </details>
        </div>`;
    }

    function rangeHtml(payload) {
      const bounds = systemBounds(payload, payload.selected_system.id);
      const preset = state.preset || '36';
      const disabled = !isNum(bounds.last);
      const button = (value, label) => `
        <button type="button" class="player-ratings-range-btn" data-range="${value}"
          aria-pressed="${preset === value}" ${disabled ? 'disabled' : ''}>${label}</button>`;
      return `
        <div class="player-ratings-range" role="group" aria-label="时间范围">
          ${button('all', '全部')}
          ${button('12', '近12个月')}
          ${button('36', '近36个月')}
          <span class="player-ratings-range-custom">
            <input type="month" data-range-from aria-label="起始月份" value="${esc(monthInputValue(state.from))}"
              min="${esc(monthInputValue(bounds.first))}" max="${esc(monthInputValue(bounds.last))}" ${disabled ? 'disabled' : ''}>
            <span aria-hidden="true">至</span>
            <input type="month" data-range-to aria-label="结束月份" value="${esc(monthInputValue(state.to))}"
              min="${esc(monthInputValue(bounds.first))}" max="${esc(monthInputValue(bounds.last))}" ${disabled ? 'disabled' : ''}>
          </span>
        </div>
        <p class="player-ratings-note" data-range-note hidden></p>`;
    }

    function brushHtml(payload) {
      const bounds = systemBounds(payload, payload.selected_system.id);
      if (!isNum(bounds.first) || !isNum(bounds.last) || bounds.first >= bounds.last) return '';
      const minIdx = monthToIndex(bounds.first);
      const maxIdx = monthToIndex(bounds.last);
      const span = Math.max(1, maxIdx - minIdx);
      const curFrom = isNum(state.from) ? Math.max(bounds.first, Math.min(bounds.last, state.from)) : bounds.first;
      const curTo = isNum(state.to) ? Math.max(curFrom, Math.min(bounds.last, state.to)) : bounds.last;
      const leftPct = ((monthToIndex(curFrom) - minIdx) / span) * 100;
      const rightPct = ((monthToIndex(curTo) - minIdx) / span) * 100;
      const widthPct = Math.max(2, rightPct - leftPct);
      return `
        <div class="player-ratings-brush" data-ratings-brush
             data-min-mk="${bounds.first}" data-max-mk="${bounds.last}"
             aria-label="拖动调整时间区间">
          <div class="player-ratings-brush-track">
            <div class="player-ratings-brush-window" data-brush-window style="left:${leftPct.toFixed(2)}%;width:${widthPct.toFixed(2)}%">
              <span class="player-ratings-brush-handle" data-brush-handle="start" role="slider" tabindex="0"
                    aria-label="起始时间滑块" aria-valuemin="${bounds.first}" aria-valuemax="${bounds.last}" aria-valuenow="${curFrom}"></span>
              <span class="player-ratings-brush-handle" data-brush-handle="end" role="slider" tabindex="0"
                    aria-label="结束时间滑块" aria-valuemin="${bounds.first}" aria-valuemax="${bounds.last}" aria-valuenow="${curTo}"></span>
            </div>
          </div>
          <div class="player-ratings-brush-labels">
            <span>${esc(fmtMonthKey(bounds.first))}</span>
            <span>${esc(fmtMonthKey(bounds.last))}</span>
          </div>
        </div>`;
    }

    function chartSectionHtml(payload) {
      const isDateSystem = payload.selected_system && (payload.selected_system.time_scale === 'date' || payload.selected_system.id === 'goratings');
      const metric = state.metric === 'rank' ? 'rank' : 'rating';
      const ratingLabel = isDateSystem ? 'WHR 估值' : '分值';
      const rankLabel = '排名';
      const chartAria = metric === 'rank'
        ? (isDateSystem ? '榜单排名走势' : '公布排名走势')
        : (isDateSystem ? 'WHR 估值走势' : '公示分走势');
      return `
        <div class="player-ratings-chart-panel" data-ratings-charts>
          <div class="player-ratings-chart-bar">
            <div class="player-ratings-metric-switch" role="group" aria-label="图表指标">
              <button type="button" class="player-ratings-metric-btn" data-chart-metric="rating"
                aria-pressed="${metric === 'rating'}">${ratingLabel}</button>
              <button type="button" class="player-ratings-metric-btn" data-chart-metric="rank"
                aria-pressed="${metric === 'rank'}">${rankLabel}</button>
            </div>
            <label class="player-ratings-all-labels">
              <input type="checkbox" data-chart-all-labels ${state.showAllLabels ? 'checked' : ''}>
              显示全部数值
            </label>
          </div>
          <figure class="player-ratings-chart">
            <div class="player-ratings-chart-scroll" data-chart="${metric}" tabindex="0"
                 aria-label="${esc(chartAria)}，可横向滚动查看"></div>
          </figure>
          ${brushHtml(payload)}
        </div>`;
    }

    function tableInnerHtml(payload) {
      const isDateSystem = payload.selected_system && (payload.selected_system.time_scale === 'date' || payload.selected_system.id === 'goratings');
      const deltaBasisLabel = isDateSystem ? '较上条 WHR 记录' : '较上月计算';
      const items = payload.items || [];
      const pagination = payload.pagination || {};
      const total = pagination.total || 0;
      const rows = items.map(item => {
        const ratingChange = item.changes && item.changes.rating;
        const rankChange = item.changes && item.changes.rank;
        const ratingDelta = ratingChange && isNum(ratingChange.value)
          ? `${ratingChange.value > 0 ? '+' : ''}${Number(ratingChange.value).toFixed(1)}`
          : '—';
        const statusChips = [];
        if (item.status && item.status !== 'ok') {
          statusChips.push(`<span class="player-ratings-chip" data-status="${esc(item.status)}">${esc(item.status_label)}</span>`);
        }
        (item.exclusion_reasons || []).forEach(reason => {
          statusChips.push(`<span class="player-ratings-chip" data-status="excluded" title="${esc(reason.label)}">${esc(reason.code === 'identity_conflict' ? '身份冲突' : reason.code === 'multiple_entries_same_month' ? '同月多记录' : '已排除')}</span>`);
        });
        (item.limitations || []).forEach(reason => {
          statusChips.push(`<span class="player-ratings-chip" data-status="limitation" title="${esc(reason.label)}">排名不参与</span>`);
        });
        const rawRating = item.raw_changes && item.raw_changes.rating_change ? item.raw_changes.rating_change : '—';
        const rawRank = item.raw_changes && item.raw_changes.rank_change ? item.raw_changes.rank_change : '—';
        const source = item.source || {};
        const linkIds = (source.link_ids || []).join('、') || '—';
        const rawRecord = source.raw_record && typeof source.raw_record === 'object'
          ? JSON.stringify(source.raw_record)
          : (source.raw_record || '—');
        const dateOrMonth = item.date || item.month;
        return `<tr data-month="${esc(dateOrMonth)}" data-status="${esc(item.status)}">
          <th scope="row">${esc(dateOrMonth)}</th>
          <td class="player-ratings-num">${esc(fmtRating(item.public_rating))}</td>
          <td class="player-ratings-num">${isNum(item.rank) && Number(item.rank) > 0 ? `第 ${esc(item.rank)} 名` : '—'}</td>
          <td class="player-ratings-num">${esc(ratingDelta)}</td>
          <td class="player-ratings-num">${esc(rankChange && rankChange.label ? rankChange.label : '—')}</td>
          <td>${statusChips.length ? statusChips.join('') : '—'}</td>
          <td>
            <details class="player-ratings-source">
              <summary>追溯</summary>
              <dl>
                <div><dt>记录</dt><dd>#${esc(source.entry_id)} · ${esc(source.snapshot_id)}（第 ${esc(source.snapshot_revision)} 版）</dd></div>
                <div><dt>匹配关联</dt><dd>${esc(linkIds)}</dd></div>
                <div><dt>原文变动</dt><dd>分值：${esc(rawRating)}；名次：${esc(rawRank)}</dd></div>
                <div><dt>来源定位</dt><dd>${esc(source.source_locator || '—')}</dd></div>
                <div><dt>原文</dt><dd><code>${esc(rawRecord)}</code></dd></div>
              </dl>
            </details>
          </td>
        </tr>`;
      }).join('');

      const empty = total === 0
        ? `<tr><td colspan="7" class="player-ratings-empty">${esc(emptyTableText(payload))}</td></tr>`
        : '';
      return `
        <div class="player-ratings-table-toolbar">
          <label class="player-ratings-include" ${isDateSystem ? 'style="display:none;"' : ''}>
            <input type="checkbox" data-include-excluded ${state.includeExcluded ? 'checked' : ''}>
            包含无效/冲突记录
          </label>
        </div>
        <div class="player-ratings-table-wrap" tabindex="0" role="region"
             aria-label="${esc(payload.selected_system.display_name)}明细表">
          <table class="player-ratings-table">
            <caption>明细</caption>
            <thead><tr>
              <th scope="col">${isDateSystem ? '日期' : '月份'}</th>
              <th scope="col">${isDateSystem ? 'WHR 估值' : '公示分'}</th>
              <th scope="col">${isDateSystem ? '榜单排名' : '公布排名'}</th>
              <th scope="col" title="${esc(deltaBasisLabel)}">分值变化</th>
              <th scope="col" title="${esc(deltaBasisLabel)}">名次变化</th>
              <th scope="col">状态</th>
              <th scope="col">来源</th>
            </tr></thead>
            <tbody data-ratings-rows>${rows}${empty}</tbody>
          </table>
        </div>
        <div class="player-ratings-pager">
          <span>${pagination.pages ? `${pagination.page || 1} / ${pagination.pages} · ` : ''}共 ${total} 条</span>
          <label>每页
            <select data-page-size aria-label="每页明细条数">
              ${PAGE_SIZES.map(size => `<option value="${size}" ${state.pageSize === size ? 'selected' : ''}>${size}</option>`).join('')}
            </select>
          </label>
          <button type="button" class="btn btn-sm" data-page="prev" ${pagination.has_prev ? '' : 'disabled'}>上一页</button>
          <button type="button" class="btn btn-sm" data-page="next" ${pagination.has_next ? '' : 'disabled'}>下一页</button>
        </div>`;
    }

    function emptyTableText(payload) {
      const coverage = payload.coverage || {};
      const all = coverage.all_time || {};
      const scope = coverage.scope || {};
      if ((all.valid_rating_records || 0) === 0) {
        return (all.conflict_records || 0) > 0
          ? '当前仅有冲突记录，可勾选“包含无效/冲突记录”查看。'
          : '暂无有效公示分记录。';
      }
      if ((scope.invalid_rating_months || 0) + (scope.conflict_months || 0) > 0) {
        return '当前区间暂无有效记录，可勾选“包含无效/冲突记录”查看。';
      }
      return '当前区间暂无等级分明细。';
    }

    function renderTableOnly(payload) {
      const details = body.querySelector('[data-ratings-details]');
      if (!details) return;
      const summary = details.querySelector('summary');
      const total = (payload.pagination || {}).total || 0;
      if (summary) summary.textContent = `历史明细（${total} 条）`;
      const container = details.querySelector('[data-ratings-table-container]');
      if (container && details.open) {
        container.innerHTML = tableInnerHtml(payload);
        state.tableRendered = true;
        bindTableInteractions(payload);
      }
    }

    function renderArchive(payload) {
      const isDateSystem = payload.selected_system && (payload.selected_system.time_scale === 'date' || payload.selected_system.id === 'goratings');
      const total = (payload.pagination || {}).total || 0;
      setBadge('', 'ok', false);
      state.tableRendered = false;
      body.innerHTML = `
        ${tabsHtml(payload)}
        ${summaryCards(payload)}
        ${coverageHtml(payload)}
        ${rangeHtml(payload)}
        ${chartSectionHtml(payload)}
        <details class="player-ratings-table-disclosure" data-ratings-details ${state.detailsOpen ? 'open' : ''}>
          <summary>历史明细（${total} 条）</summary>
          <div class="player-ratings-table-container" data-ratings-table-container>
            ${state.detailsOpen ? tableInnerHtml(payload) : ''}
          </div>
        </details>
        <p class="player-ratings-foot">${isDateSystem ? '来源：GoRatings (WHR)' : '来源：月度等级分榜单'}</p>`;

      if (state.detailsOpen) {
        state.tableRendered = true;
        bindTableInteractions(payload);
      }
      const detailsEl = body.querySelector('[data-ratings-details]');
      detailsEl?.addEventListener('toggle', () => {
        state.detailsOpen = detailsEl.open;
        if (detailsEl.open && !state.tableRendered) {
          const containerEl = detailsEl.querySelector('[data-ratings-table-container]');
          if (containerEl) {
            containerEl.innerHTML = tableInnerHtml(state.payload);
            state.tableRendered = true;
            bindTableInteractions(state.payload);
          }
        }
      });

      bindTabs();
      bindRange(payload);
      bindBrush(payload);
      bindChartControls(payload);
      renderCharts(payload);
    }

    function bindTableInteractions(payload) {
      bindPager(payload);
      body.querySelector('[data-include-excluded]')?.addEventListener('change', event => {
        navigate({includeExcluded: event.target.checked, page: 1}, {push: false});
      });
      const tbody = body.querySelector('[data-ratings-rows]');
      if (tbody) {
        tbody.addEventListener('mouseover', event => {
          const tr = event.target instanceof Element ? event.target.closest('tr[data-month]') : null;
          if (!tr) return;
          state.charts.forEach(c => c.highlightMonth?.(tr.dataset.month));
        });
        tbody.addEventListener('mouseout', event => {
          const related = event.relatedTarget instanceof Element ? event.relatedTarget.closest('[data-ratings-rows]') : null;
          if (!related) state.charts.forEach(c => c.clearHighlight?.());
        });
      }
    }

    function handlePointClick(info) {
      if (!info || !state.payload) return;
      const details = body.querySelector('[data-ratings-details]');
      if (!details) return;
      if (!details.open) {
        details.open = true;
        state.detailsOpen = true;
        if (!state.tableRendered) {
          const containerEl = details.querySelector('[data-ratings-table-container]');
          if (containerEl) {
            containerEl.innerHTML = tableInnerHtml(state.payload);
            state.tableRendered = true;
            bindTableInteractions(state.payload);
          }
        }
      }
      const key = info.date || fmtMonthKey(info.month_key);
      const matchRow = body.querySelector(`[data-ratings-rows] tr[data-month="${CSS.escape(key)}"]`);
      if (matchRow) {
        body.querySelectorAll('[data-ratings-rows] tr.is-highlighted').forEach(r => r.classList.remove('is-highlighted'));
        matchRow.classList.add('is-highlighted');
        matchRow.scrollIntoView({block: 'nearest', behavior: 'smooth'});
      }
    }

    async function renderCharts(payload) {
      destroyCharts();
      const host = body.querySelector('[data-chart]');
      if (!host) return;
      let chartModule = window.GoViewerRatingsChart;
      if (!chartModule || typeof chartModule.create !== 'function') {
        host.innerHTML = '<p class="ratings-chart-empty" role="status">正在加载图表组件…</p>';
        try {
          chartModule = await ensureChartScript();
        } catch (_) {
          if (!state.destroyed) host.innerHTML = '<p class="ratings-chart-empty">图表组件未能加载。</p>';
          return;
        }
      }
      if (state.destroyed || state.payload !== payload) return;
      const currentHost = body.querySelector('[data-chart]');
      if (!currentHost || currentHost !== host) return;

      const isDateSystem = payload.selected_system && (payload.selected_system.time_scale === 'date' || payload.selected_system.id === 'goratings');
      const series = payload.series || [];
      const months = series.map(item => ({
        month_key: item.month_key,
        month_str: item.date || item.month_str || item.month,
        date: item.date || null
      }));
      const monthStates = {};
      series.forEach(item => {
        monthStates[item.month_key] = {state: item.state, label: item.state_label};
      });
      const name = payload.player ? payload.player.name_zh : '';
      const uid = `pr${++uidCounter}`;
      const isRank = state.metric === 'rank';

      const scopeFrom = payload.scope && isNum(payload.scope.from) ? payload.scope.from : null;
      const scopeTo = payload.scope && isNum(payload.scope.to) ? payload.scope.to : null;
      const annualSource = (isDateSystem && Array.isArray(payload.annual_snapshots) && payload.annual_snapshots.length > 0)
        ? payload.annual_snapshots.filter(s => s.rank && s.rank > 0 && (!scopeFrom || s.month_key >= scopeFrom) && (!scopeTo || s.month_key <= scopeTo))
        : null;

      const history = isRank
        ? (annualSource
          ? annualSource.map(s => ({
            month_key: s.month_key,
            month_str: s.date || String(s.month_key),
            date: s.date || null,
            public_rating: s.rating,
            rank: s.rank
          }))
          : series.filter(item => item.has_rank).map(item => ({
            month_key: item.month_key,
            month_str: item.date || item.month_str || item.month,
            date: item.date || null,
            public_rating: item.rating,
            rank: item.rank
          })))
        : series.filter(item => item.has_rating).map(item => ({
          month_key: item.month_key,
          month_str: item.date || item.month_str || item.month,
          date: item.date || null,
          public_rating: item.rating,
          rank: item.rank
        }));

      const activeMonths = (isRank && annualSource)
        ? annualSource.map(s => ({month_key: s.month_key, month_str: s.date || String(s.month_key), date: s.date || null}))
        : months;

      const chartAnnotations = !isRank && state.annotations.length
        ? state.annotations.map(t => ({
          month_key: t.date && t.date.length >= 7 ? Number(t.date.slice(0, 7).replace('-', '')) : (t.year ? t.year * 100 + 6 : 0),
          date: t.date || '',
          label: `${t.tournament_short || ''} ${t.edition_label || ''}`.trim()
        }))
        : null;

      const chart = chartModule.create(host, {
        mode: 'single-metric',
        metric: isRank ? 'rank' : 'rating',
        timeScale: isDateSystem ? 'date' : 'month',
        systemName: payload.selected_system.display_name,
        sparseX: isDateSystem ? true : (series.length > 30),
        showLabels: true,
        labelMode: state.showAllLabels ? 'all' : 'extreme',
        showPoints: history.length <= 120,
        sampling: 'all',
        smooth: false,
        showGrid: true,
        ptSize: 'auto',
        theme: state.theme,
        breakOnMissing: !isDateSystem,
        hideTitle: true,
        idPrefix: isRank ? `${uid}Rank` : `${uid}Score`,
        chartTitle: isRank
          ? (isDateSystem ? `${name} · 榜单排名走势` : `${name} · 公布排名走势`)
          : (isDateSystem ? `${name} · WHR 估值走势` : `${name} · 公示分走势`),
        axisLabel: isRank
          ? (isDateSystem ? '榜单排名' : '公布排名')
          : (isDateSystem ? 'WHR 等级分' : '公示分'),
        emptyText: isRank
          ? (isDateSystem ? '所选范围内未进入年度或实时榜单排名。' : '所选范围内没有可用的公布排名记录。')
          : (isDateSystem ? '所选范围内没有 WHR 估值记录。' : '所选范围内没有有效公示分记录。'),
        annotations: chartAnnotations,
        onPointClick: handlePointClick
      });
      chart.setData({
        months: activeMonths,
        players: [{player_clean: name, history}],
        monthStates,
        time_scale: isDateSystem ? 'date' : 'month'
      });
      state.charts = [chart];
    }

    function destroyCharts() {
      state.charts.forEach(chart => {
        try { chart.destroy?.(); } catch (_) {}
      });
      state.charts = [];
    }

    function bindChartControls(payload) {
      body.querySelectorAll('[data-chart-metric]').forEach(btn => {
        btn.addEventListener('click', () => {
          const next = btn.dataset.chartMetric;
          if (!next || next === state.metric) return;
          state.metric = next;
          writeUrl('replace');
          body.querySelectorAll('[data-chart-metric]').forEach(b => {
            b.setAttribute('aria-pressed', String(b.dataset.chartMetric === state.metric));
          });
          const host = body.querySelector('[data-chart]');
          if (host) host.dataset.chart = state.metric;
          renderCharts(payload);
        });
      });
      body.querySelector('[data-chart-all-labels]')?.addEventListener('change', event => {
        state.showAllLabels = Boolean(event.target.checked);
        try { localStorage.setItem(ALL_LABELS_KEY, state.showAllLabels ? '1' : '0'); } catch (_) {}
        state.charts.forEach(c => {
          try { c.setOptions({labelMode: state.showAllLabels ? 'all' : 'extreme'}); } catch (_) {}
        });
      });
    }

    function bindBrush(payload) {
      const brush = body.querySelector('[data-ratings-brush]');
      if (!brush) return;
      const track = brush.querySelector('.player-ratings-brush-track');
      const win = brush.querySelector('[data-brush-window]');
      const minMk = Number(brush.dataset.minMk);
      const maxMk = Number(brush.dataset.maxMk);
      if (!track || !win || !isNum(minMk) || !isNum(maxMk) || minMk >= maxMk) return;
      const minIdx = monthToIndex(minMk);
      const maxIdx = monthToIndex(maxMk);
      const span = Math.max(1, maxIdx - minIdx);

      let curFromIdx = monthToIndex(isNum(state.from) ? Math.max(minMk, Math.min(maxMk, state.from)) : minMk);
      let curToIdx = monthToIndex(isNum(state.to) ? Math.max(minMk, Math.min(maxMk, state.to)) : maxMk);

      const syncWindowUi = (fIdx, tIdx) => {
        const l = ((fIdx - minIdx) / span) * 100;
        const w = Math.max(2, ((tIdx - fIdx) / span) * 100);
        win.style.left = `${l.toFixed(2)}%`;
        win.style.width = `${w.toFixed(2)}%`;
        const fromInput = body.querySelector('[data-range-from]');
        const toInput = body.querySelector('[data-range-to]');
        if (fromInput) fromInput.value = monthInputValue(indexToMonth(fIdx));
        if (toInput) toInput.value = monthInputValue(indexToMonth(tIdx));
      };

      win.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const handleEl = event.target instanceof Element ? event.target.closest('[data-brush-handle]') : null;
        const mode = handleEl ? handleEl.dataset.brushHandle : 'move';
        event.preventDefault();
        const rect = track.getBoundingClientRect();
        if (!rect.width) return;
        const startX = event.clientX;
        const origFrom = curFromIdx;
        const origTo = curToIdx;
        let nextFrom = origFrom;
        let nextTo = origTo;

        const onMove = mv => {
          const deltaIdx = Math.round(((mv.clientX - startX) / rect.width) * span);
          if (mode === 'start') {
            nextFrom = Math.max(minIdx, Math.min(origTo, origFrom + deltaIdx));
          } else if (mode === 'end') {
            nextTo = Math.min(maxIdx, Math.max(origFrom, origTo + deltaIdx));
          } else {
            const width = origTo - origFrom;
            let f = origFrom + deltaIdx;
            if (f < minIdx) f = minIdx;
            if (f + width > maxIdx) f = maxIdx - width;
            nextFrom = f;
            nextTo = f + width;
          }
          syncWindowUi(nextFrom, nextTo);
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          if (nextFrom !== origFrom || nextTo !== origTo) {
            curFromIdx = nextFrom;
            curToIdx = nextTo;
            navigate({
              from: indexToMonth(nextFrom),
              to: indexToMonth(nextTo),
              page: 1,
              preset: 'custom'
            }, {push: true});
          }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      });
    }

    function bindTabs() {
      body.querySelectorAll('[data-system]').forEach(button => {
        button.addEventListener('click', () => {
          const systemId = button.dataset.system;
          if (!systemId || state.system === systemId) return;
          const preset = state.preset === 'custom' ? 'custom' : (state.preset || '36');
          const range = preset === 'custom' ? {from: state.from, to: state.to} : presetRange(preset, systemId);
          navigate({system: systemId, from: range.from, to: range.to, page: 1, preset}, {push: true});
        });
      });
    }

    function bindRange(payload) {
      body.querySelectorAll('[data-range]').forEach(button => {
        button.addEventListener('click', () => {
          const preset = button.dataset.range;
          const range = presetRange(preset, state.system || payload.selected_system.id);
          navigate({from: range.from, to: range.to, page: 1, preset}, {push: true});
        });
      });
      const fromInput = body.querySelector('[data-range-from]');
      const toInput = body.querySelector('[data-range-to]');
      const applyCustom = () => {
        const from = parseMonthInput(fromInput ? fromInput.value : '');
        const to = parseMonthInput(toInput ? toInput.value : '');
        if (!isNum(from) || !isNum(to)) return;
        if (from > to) {
          const note = body.querySelector('[data-range-note]');
          if (note) {
            note.hidden = false;
            note.textContent = '起始月份不能晚于结束月份，请调整后再试。';
          }
          return;
        }
        const note = body.querySelector('[data-range-note]');
        if (note) {
          note.hidden = true;
          note.textContent = '';
        }
        navigate({from, to, page: 1, preset: 'custom'}, {push: true});
      };
      fromInput?.addEventListener('change', applyCustom);
      toInput?.addEventListener('change', applyCustom);
    }

    function bindPager(payload) {
      body.querySelector('[data-page="prev"]')?.addEventListener('click', () => {
        if (state.page <= 1) return;
        navigate({page: state.page - 1}, {push: false});
      });
      body.querySelector('[data-page="next"]')?.addEventListener('click', () => {
        const pages = (payload.pagination || {}).pages || 0;
        if (state.page >= pages) return;
        navigate({page: state.page + 1}, {push: false});
      });
      body.querySelector('[data-page-size]')?.addEventListener('change', event => {
        const size = parseInt(event.target.value, 10);
        if (!PAGE_SIZES.includes(size)) return;
        navigate({pageSize: size, page: 1}, {push: false});
      });
    }

    function onPopState() {
      if (state.destroyed) return;
      const next = readUrlState();
      const changed = next.system !== state.system || next.from !== state.from || next.to !== state.to
        || next.page !== state.page || next.pageSize !== state.pageSize
        || next.includeExcluded !== state.includeExcluded || next.metric !== state.metric;
      if (!changed) return;
      applyUrlState(next);
      fetchArchive();
    }

    function onThemeChange() {
      const theme = currentTheme();
      if (theme === state.theme) return;
      state.theme = theme;
      state.charts.forEach(chart => {
        try { chart.setOptions({theme}); } catch (_) {}
      });
    }

    function setupLazyLoad() {
      const urlState = readUrlState();
      const hasDeepLink = Boolean(urlState.system || isNum(urlState.from) || isNum(urlState.to));
      if (hasDeepLink || location.hash === '#ratings') {
        start();
        return;
      }
      if (typeof IntersectionObserver !== 'undefined') {
        state.io = new IntersectionObserver(entries => {
          if (entries.some(entry => entry.isIntersecting)) {
            state.io?.disconnect();
            state.io = null;
            start();
          }
        }, {rootMargin: '300px 0px'});
        state.io.observe(container);
      } else {
        start();
      }
      const navHandler = () => start();
      state.navHandler = navHandler;
      navLink?.addEventListener('click', navHandler);
    }

    function destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      state.token++;
      if (state.controller) state.controller.abort();
      if (state.io) state.io.disconnect();
      state.io = null;
      if (state.themeObserver) state.themeObserver.disconnect();
      state.themeObserver = null;
      window.removeEventListener('popstate', onPopState);
      if (navLink && state.navHandler) navLink.removeEventListener('click', state.navHandler);
      destroyCharts();
      container.innerHTML = '';
      if (container.dataset) delete container.dataset.playerRatingsMounted;
      if (instances.get(container) === instance) instances.delete(container);
      state.payload = null;
    }

    window.addEventListener('popstate', onPopState);
    if (typeof MutationObserver !== 'undefined' && document.body) {
      state.themeObserver = new MutationObserver(onThemeChange);
      state.themeObserver.observe(document.body, {attributes: true, attributeFilter: ['data-theme']});
    }

    if (!playerId) {
      shell.dataset.ratingsState = 'unlinked';
      setBadge('缺少棋手参数', 'error', true);
      body.removeAttribute('aria-busy');
      body.innerHTML = '<p class="player-ratings-notice" role="alert">缺少棋手参数，无法加载等级分档案。</p>';
    } else {
      setupLazyLoad();
    }

    return instance;
  }

  function mount(container, options) {
    if (!container) {
      return {destroy() {}, refresh() {}, load() {}, getState() { return null; }, setAnnotations() {}};
    }
    const previous = instances.get(container);
    if (previous) previous.destroy();
    const instance = createInstance(container, options || {});
    instances.set(container, instance);
    return instance;
  }

  window.GoViewerPlayerRatings = {mount};
})();
