/* 棋手独立资料页 · 等级分档案模块（只读）。
 *
 * 公开接口：window.GoViewerPlayerRatings.mount(container, {playerId})
 * 返回实例：{destroy(), refresh(), load(), getState()}。
 *
 * 约定：
 * 1. 只调用 GET /api/ratings/player-archive；严格按玩家 ID 展示已审核关联；
 * 2. 摘要与图表都由同一份档案响应驱动，不加载等级分工作区脚本；
 * 3. 图表复用 window.GoViewerRatingsChart 的 single-metric 模式；
 * 4. URL 只读写 rating_* 参数，不覆盖人物 ID、交锋或战绩页的状态；
 * 5. 重复 mount 会先销毁上一实例，避免重复监听、tooltip 与图表残留。
 */
(function () {
  'use strict';

  const DEFAULT_PAGE_SIZE = 25;
  const PAGE_SIZES = [25, 50, 100];
  const URL_KEYS = {
    system: 'rating_system',
    from: 'rating_from',
    to: 'rating_to',
    page: 'rating_page',
    size: 'rating_size',
    excluded: 'rating_excluded'
  };

  const instances = new WeakMap();
  let uidCounter = 0;

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

  const fmtMonthText = value => {
    if (!isNum(value)) return '—';
    const mk = Number(value);
    return `${Math.floor(mk / 100)}年${mk % 100}月`;
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

  function readUrlState() {
    const params = new URLSearchParams(location.search);
    const rawPage = parseInt(params.get(URL_KEYS.page) || '1', 10);
    const rawSize = parseInt(params.get(URL_KEYS.size) || String(DEFAULT_PAGE_SIZE), 10);
    return {
      system: params.get(URL_KEYS.system) || null,
      from: parseMonthParam(params.get(URL_KEYS.from)),
      to: parseMonthParam(params.get(URL_KEYS.to)),
      page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
      pageSize: PAGE_SIZES.includes(rawSize) ? rawSize : DEFAULT_PAGE_SIZE,
      includeExcluded: ['1', 'true'].includes(String(params.get(URL_KEYS.excluded) || '').toLowerCase())
    };
  }

  function statusTone(status) {
    if (status === 'unavailable') return 'error';
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
    const state = {
      destroyed: false,
      started: false,
      loading: false,
      error: null,
      payload: null,
      system: null,
      from: null,
      to: null,
      preset: null,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      includeExcluded: false,
      token: 0,
      controller: null,
      charts: [],
      io: null,
      themeObserver: null,
      clamped: false,
      theme: currentTheme()
    };

    const instance = {destroy, refresh: () => fetchArchive(), load: start, getState: () => state};

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
             href="ratings.html?tab=trend">等级分工作区</a>
          <span class="player-ratings-badge" data-ratings-badge role="status">加载中</span>
        </div>
      </div>
      <div class="player-ratings-body" data-ratings-body>
        <p class="player-ratings-loading" role="status">加载中…</p>
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
      // 等级分工作区是本地治理页；公开只读站不提供入口。
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

    function setBadge(text, tone) {
      badge.textContent = text;
      badge.dataset.tone = tone || 'ok';
    }

    function start() {
      if (state.destroyed || state.started) return;
      state.started = true;
      const urlState = readUrlState();
      // 深链接已经指明体系或范围时立即加载；普通进入仍按视口懒加载。
      applyUrlState(urlState);
      fetchArchive();
    }

    function applyUrlState(urlState) {
      state.system = urlState.system;
      state.from = urlState.from;
      state.to = urlState.to;
      state.page = urlState.page;
      state.pageSize = urlState.pageSize;
      state.includeExcluded = urlState.includeExcluded;
      state.preset = null;
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
      try {
        if (mode === 'push') history.pushState({playerRatings: true}, '', url.href);
        else history.replaceState({playerRatings: true}, '', url.href);
      } catch (_) {
        // 本地 file:// 等环境不允许改写历史时，仅保留内存状态。
      }
    }

    function buildParams() {
      const params = new URLSearchParams();
      params.set('player_id', playerId);
      if (state.system) params.set('system', state.system);
      if (isNum(state.from)) params.set('from', String(state.from));
      if (isNum(state.to)) params.set('to', String(state.to));
      if (state.page > 1) params.set('page', String(state.page));
      if (state.pageSize !== DEFAULT_PAGE_SIZE) params.set('page_size', String(state.pageSize));
      if (state.includeExcluded) params.set('include_excluded', '1');
      return params;
    }

    async function fetchArchive() {
      if (state.destroyed) return;
      const token = ++state.token;
      if (state.controller) state.controller.abort();
      state.controller = new AbortController();
      state.loading = true;
      state.error = null;
      if (!state.payload) {
        body.innerHTML = '<p class="player-ratings-loading" role="status">加载中…</p>';
        shell.dataset.ratingsState = 'loading';
      }
      setBadge(BADGE_TEXT.loading, 'loading');

      let response;
      try {
        const url = new URL('api/ratings/player-archive', location.href);
        url.search = buildParams().toString();
        response = await fetch(url, {
          headers: {Accept: 'application/json'},
          cache: 'no-store',
          signal: state.controller.signal
        });
      } catch (error) {
        if (error.name === 'AbortError' || token !== state.token || state.destroyed) return;
        state.loading = false;
        state.error = error.message || '网络请求失败';
        render();
        return;
      }

      let payload = null;
      try {
        payload = await response.json();
      } catch (_) {
        payload = null;
      }
      if (token !== state.token || state.destroyed) return;
      if (!response.ok) {
        state.loading = false;
        state.error = (payload && payload.error) || `HTTP ${response.status}`;
        render();
        return;
      }
      if (!payload || typeof payload !== 'object') {
        state.loading = false;
        state.error = '接口返回内容不是有效的档案数据。';
        render();
        return;
      }
      applyPayload(payload);
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

    function navigate(patch, options) {
      const opts = options || {};
      if ('system' in patch) state.system = patch.system;
      if ('from' in patch) state.from = patch.from;
      if ('to' in patch) state.to = patch.to;
      if ('preset' in patch) state.preset = patch.preset;
      if ('page' in patch) state.page = patch.page;
      if ('pageSize' in patch) state.pageSize = patch.pageSize;
      if ('includeExcluded' in patch) state.includeExcluded = patch.includeExcluded;
      writeUrl(opts.push ? 'push' : 'replace');
      fetchArchive();
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
        body.innerHTML = '<p class="player-ratings-loading" role="status">加载中…</p>';
        shell.dataset.ratingsState = 'loading';
        setBadge(BADGE_TEXT.loading, 'loading');
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
      return `
        <div class="player-ratings-tabs" role="tablist" aria-label="等级分体系">
          ${systems.map(system => {
            const active = system.id === selected;
            const linkedText = system.linked
              ? (system.record_count ? `${system.record_count} 条` : '已关联 · 无记录')
              : '未关联';
            return `<button type="button" role="tab" class="player-ratings-tab" data-system="${esc(system.id)}"
              aria-selected="${active}" tabindex="${active ? 0 : -1}">
              <span>${esc(system.name)}</span>
              <small data-linked="${system.linked ? '1' : '0'}">${esc(linkedText)}</small>
            </button>`;
          }).join('')}
        </div>`;
    }

    function candidateHintHtml(payload) {
      const identity = payload.identity || {};
      const hint = identity.hint;
      if (payload.status === 'ok' || !hint || !hint.player_names || !hint.player_names.length) return '';
      const stateLabels = {pending: '待审核', conflict: '同名冲突', approved: '已审核'};
      const names = hint.player_names.map(name => `「${esc(name)}」`).join('、');
      const states = (hint.states || []).map(item => stateLabels[item] || item).join(' / ');
      return `<p class="player-ratings-hint">同名候选：${names}${states ? `（${esc(states)}）` : ''}。</p>`;
    }

    function messageForStatus(payload) {
      const identity = payload.identity || {};
      const systems = payload.available_systems || [];
      const selected = payload.selected_system || {};
      const systemName = selected.name || '所选';
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
      setBadge(BADGE_TEXT[status] || '未关联', statusTone(status));
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
      body.querySelector('[data-ratings-retry]')?.addEventListener('click', () => fetchArchive());
    }

    function renderError() {
      setBadge(BADGE_TEXT.error, 'error');
      shell.dataset.ratingsState = 'error';
      body.innerHTML = `
        ${state.payload ? tabsHtml(state.payload) : ''}
        <div class="player-ratings-notice" data-ratings-error role="alert">
          <p>等级分档案读取失败，请稍后重试。</p>
          <button type="button" class="btn btn-sm" data-ratings-retry>重试</button>
        </div>`;
      bindTabs();
      body.querySelector('[data-ratings-retry]')?.addEventListener('click', () => fetchArchive());
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
          : '暂无有效公示分');
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
        ? `<details class="player-ratings-tie"><summary>查看并列 ${count} 次</summary><p>${list.map(esc).join('、')}</p></details>`
        : '';
      return `
        <div class="player-ratings-summary" aria-label="历史概况">
          <div class="player-ratings-card" data-rating-card="latest">
            <span>${isDateSystem ? '最新 WHR 估值' : '最近有效公示分'}</span>
            <strong>${esc(fmtRating(latestRatingVal))}</strong>
            <small>${esc(latestNote)}</small>
          </div>
          <div class="player-ratings-card" data-rating-card="rank">
            <span>${isDateSystem ? '最新榜单排名' : '对应公布排名'}</span>
            <strong>${esc(rankText)}</strong>
            <small>${esc(latestDateText)}</small>
          </div>
          <div class="player-ratings-card" data-rating-card="peak" title="${esc(peakTitle)}">
            <span>${isDateSystem ? 'WHR 历史最高分' : '最高有效公示分'}</span>
            <strong>${esc(peak ? fmtRating(peak.value) : '—')}</strong>
            <small>${esc(peak ? `${peakFirstText} · ${peakCount > 1 ? `并列 ${peakCount} 次` : '唯一最高'}` : '暂无')}</small>
            ${tieDetails(peakList, peakCount)}
          </div>
          <div class="player-ratings-card" data-rating-card="best" title="${esc(bestTitle)}">
            <span>${isDateSystem ? '最佳榜单排名' : '最佳公布排名'}</span>
            <strong>${esc(best ? `第 ${best.value} 名` : '—')}</strong>
            <small>${esc(best ? `首次 ${bestFirstText} · 共 ${bestCount} 次` : '暂无')}</small>
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
      const parts = isDateSystem
        ? [
          `${payload.selected_system.name}共 ${system.month_count || 0} 期快照（最新 ${fmtMonthKey(system.latest_month)}）`,
          `对局日范围：${player.first_date || fmtMonthKey(player.first_month)} 至 ${player.last_date || fmtMonthKey(player.last_month)}`,
          `共 ${player.month_count || 0} 个对局日 / ${player.record_count || 0} 条记录`
        ]
        : [
          `${payload.selected_system.name}最新榜单：${fmtMonthKey(system.latest_month)}`,
          `最近记录：${fmtMonthKey(player.latest_month)}`,
          `共 ${player.record_count || 0} 条（${player.month_count || 0} 个月），有效 ${all.valid_rating_records || 0} 条`
        ];
      const lines = [`<span>${esc(parts.join('；'))}</span>`];
      if (isDateSystem && payload.selected_system?.methodology_note) {
        lines.push(`<span>${esc(payload.selected_system.methodology_note)}</span>`);
      } else if (!isDateSystem && isNum(system.latest_month) && isNum(player.latest_month) && player.latest_month < system.latest_month) {
        lines.push(`<span>最新榜单未收录此人；最近记录为 ${esc(fmtMonthKey(player.latest_month))}。</span>`);
      }
      if (!isDateSystem && scopeRange.from_display && scopeRange.to_display) {
        lines.push(`<span>所选区间 ${esc(scopeRange.from_display)}—${esc(scopeRange.to_display)}：有效 ${scope.valid_months || 0} 个月，缺榜 ${scope.system_missing_months || 0}，未收录 ${scope.player_missing_months || 0}，无效 ${scope.invalid_rating_months || 0}，冲突 ${scope.conflict_months || 0}。</span>`);
      } else if (isDateSystem && scopeRange.from_display && scopeRange.to_display) {
        lines.push(`<span>所选区间 ${esc(scopeRange.from_display)} 至 ${esc(scopeRange.to_display)}：${scope.valid_months || 0} 个节点。</span>`);
      }
      if ((all.invalid_rating_records || 0) + (all.conflict_records || 0) > 0) {
        lines.push(`<span>已排除无效 ${all.invalid_rating_records || 0} 条、冲突 ${all.conflict_records || 0} 条。</span>`);
      }
      if ((all.valid_rating_records || 0) === 0) {
        lines.push((all.conflict_records || 0) > 0
          ? '<span class="player-ratings-warn">记录均存在冲突，暂未生成曲线。</span>'
          : '<span class="player-ratings-warn">暂无有效公示分，未生成曲线。</span>');
      }
      return `<p class="player-ratings-coverage" data-ratings-coverage>${lines.join('')}</p>`;
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
          <span class="player-ratings-range-label">时间范围</span>
          ${button('all', '全部')}
          ${button('12', '近12个月')}
          ${button('36', '近36个月')}
          <span class="player-ratings-range-custom">
            <label>自定义
              <input type="month" data-range-from value="${esc(monthInputValue(state.from))}"
                min="${esc(monthInputValue(bounds.first))}" max="${esc(monthInputValue(bounds.last))}" ${disabled ? 'disabled' : ''}>
            </label>
            <span aria-hidden="true">至</span>
            <input type="month" data-range-to aria-label="结束月份" value="${esc(monthInputValue(state.to))}"
              min="${esc(monthInputValue(bounds.first))}" max="${esc(monthInputValue(bounds.last))}" ${disabled ? 'disabled' : ''}>
          </span>
        </div>
        <p class="player-ratings-note" data-range-note hidden></p>`;
    }

    function chartFigure(dataKey, title, note) {
      const noteHtml = note ? `<span>${esc(note)}</span>` : '';
      return `
        <figure class="player-ratings-chart">
          <figcaption><strong>${esc(title)}</strong>${noteHtml}</figcaption>
          <div class="player-ratings-chart-scroll" data-chart="${dataKey}" tabindex="0"
               aria-label="${esc(title)}，可横向滚动查看完整月份"></div>
        </figure>`;
    }

    function tableHtml(payload) {
      const isDateSystem = payload.selected_system && (payload.selected_system.time_scale === 'date' || payload.selected_system.id === 'goratings');
      const deltaBasisLabel = isDateSystem ? '较上条' : '较上月计算';
      const items = payload.items || [];
      const pagination = payload.pagination || {};
      const total = pagination.total || 0;
      const rows = items.map(item => {
        const ratingChange = item.changes && item.changes.rating;
        const rankChange = item.changes && item.changes.rank;
        const ratingDelta = ratingChange && isNum(ratingChange.value)
          ? `${ratingChange.value > 0 ? '+' : ''}${Number(ratingChange.value).toFixed(1)}`
          : '—';
        const statusChips = [`<span class="player-ratings-chip" data-status="${esc(item.status)}">${esc(item.status_label)}</span>`];
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
          <td class="player-ratings-num">${esc(ratingDelta)}${ratingChange && isNum(ratingChange.value) ? `<small>${deltaBasisLabel}</small>` : ''}</td>
          <td class="player-ratings-num">${esc(rankChange && rankChange.label ? rankChange.label : '—')}${rankChange && isNum(rankChange.value) ? `<small>${deltaBasisLabel}</small>` : ''}</td>
          <td>${statusChips.join('')}</td>
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
        <div class="player-ratings-table-wrap" tabindex="0" role="region"
             aria-label="${esc(payload.selected_system.display_name)}等级分明细表，可横向滚动">
          <table class="player-ratings-table">
            <caption>${esc(payload.selected_system.display_name)}明细 · 共 ${total} 条（${esc((payload.scope || {}).from_display || '—')} 至 ${esc((payload.scope || {}).to_display || '—')}）</caption>
            <thead><tr>
              <th scope="col">${isDateSystem ? '日期' : '月份'}</th><th scope="col">${isDateSystem ? 'WHR 估值' : '公示分'}</th><th scope="col">${isDateSystem ? '榜单排名' : '公布排名'}</th>
              <th scope="col">分值变化</th><th scope="col">名次变化</th><th scope="col">资料状态</th><th scope="col">来源</th>
            </tr></thead>
            <tbody data-ratings-rows>${rows}${empty}</tbody>
          </table>
        </div>
        <div class="player-ratings-pager">
          <span>${pagination.pages ? `第 ${pagination.page || 1} / ${pagination.pages} 页 · ` : ''}共 ${total} 条</span>
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

    function renderArchive(payload) {
      const summary = payload.all_time_summary || {};
      const identity = payload.identity || {};
      const isDateSystem = payload.selected_system && (payload.selected_system.time_scale === 'date' || payload.selected_system.id === 'goratings');
      setBadge(BADGE_TEXT.ok, 'ok');
      body.innerHTML = `
        ${tabsHtml(payload)}
        <p class="player-ratings-scope-line">当前体系：<strong>${esc(payload.selected_system.display_name)}</strong>
          · <span data-identity-names>${esc(((payload.available_systems || []).find(item => item.id === payload.selected_system.id) || {}).player_names?.join('、') || '—')}</span></p>
        <h3 class="player-ratings-subhead">历史概况</h3>
        ${summaryCards(payload)}
        ${coverageHtml(payload)}
        ${rangeHtml(payload)}
        <div class="player-ratings-charts" data-ratings-charts>
          ${chartFigure('rating', isDateSystem ? 'WHR 估值走势' : '公示分走势', '')}
          ${chartFigure('rank', isDateSystem ? '年度/实时榜单排名走势' : '公布排名走势', '')}
        </div>
        <div class="player-ratings-table-head">
          <h3>历史明细</h3>
          <label class="player-ratings-include" ${isDateSystem ? 'style="display:none;"' : ''}>
            <input type="checkbox" data-include-excluded ${state.includeExcluded ? 'checked' : ''}>
            包含无效/冲突记录
          </label>
        </div>
        ${tableHtml(payload)}
        <p class="player-ratings-foot">${isDateSystem ? '数据来源：GoRatings (WHR 估值)。' : '数据来源：月度等级分榜单；“较上月计算”按相邻自然月计算。'}</p>`;
      bindTabs();
      bindRange(payload);
      bindPager(payload);
      body.querySelector('[data-include-excluded]')?.addEventListener('change', event => {
        navigate({includeExcluded: event.target.checked, page: 1}, {push: false});
      });
      renderCharts(payload);
    }

    function renderCharts(payload) {
      destroyCharts();
      const chartModule = window.GoViewerRatingsChart;
      const hosts = {
        rating: body.querySelector('[data-chart="rating"]'),
        rank: body.querySelector('[data-chart="rank"]')
      };
      if (!hosts.rating || !hosts.rank) return;
      if (!chartModule || typeof chartModule.create !== 'function') {
        hosts.rating.innerHTML = '<p class="ratings-chart-empty">图表组件未能加载。</p>';
        hosts.rank.innerHTML = '<p class="ratings-chart-empty">图表组件未能加载。</p>';
        return;
      }
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
      const base = {
        mode: 'single-metric',
        timeScale: isDateSystem ? 'date' : 'month',
        systemName: payload.selected_system.display_name,
        sparseX: isDateSystem ? true : (series.length > 30),
        showLabels: true,
        labelMode: 'all',
        showPoints: true,
        sampling: 'all',
        smooth: false,
        showGrid: true,
        ptSize: 'auto',
        theme: state.theme,
        breakOnMissing: !isDateSystem
      };
      const ratingHistory = series.filter(item => item.has_rating).map(item => ({
        month_key: item.month_key,
        month_str: item.date || item.month_str || item.month,
        date: item.date || null,
        public_rating: item.rating,
        rank: item.rank
      }));
      const scopeFrom = payload.scope && isNum(payload.scope.from) ? payload.scope.from : null;
      const scopeTo = payload.scope && isNum(payload.scope.to) ? payload.scope.to : null;
      const annualSource = (isDateSystem && Array.isArray(payload.annual_snapshots) && payload.annual_snapshots.length > 0)
        ? payload.annual_snapshots.filter(s => s.rank && s.rank > 0 && (!scopeFrom || s.month_key >= scopeFrom) && (!scopeTo || s.month_key <= scopeTo))
        : null;
      const rankHistory = annualSource
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
        }));
      const rankMonths = annualSource
        ? annualSource.map(s => ({ month_key: s.month_key, month_str: s.date || String(s.month_key), date: s.date || null }))
        : months;
      const ratingChart = chartModule.create(hosts.rating, Object.assign({}, base, {
        metric: 'rating',
        idPrefix: `${uid}Score`,
        chartTitle: isDateSystem ? `${name} · WHR 估值走势` : `${name} · 公示分走势`,
        axisLabel: isDateSystem ? 'WHR 等级分' : '公示分',
        emptyText: isDateSystem ? '所选范围内没有 WHR 估值记录。' : '所选范围内没有有效公示分记录。'
      }));
      ratingChart.setData({months, players: [{player_clean: name, history: ratingHistory}], monthStates, time_scale: isDateSystem ? 'date' : 'month'});
      const rankChart = chartModule.create(hosts.rank, Object.assign({}, base, {
        metric: 'rank',
        idPrefix: `${uid}Rank`,
        chartTitle: isDateSystem ? `${name} · 年度/实时榜单排名走势` : `${name} · 公布排名走势`,
        axisLabel: isDateSystem ? '榜单排名' : '公布排名',
        emptyText: isDateSystem ? '所选范围内未进入年度或实时榜单排名。' : '所选范围内没有可用的公布排名记录。'
      }));
      rankChart.setData({months: rankMonths, players: [{player_clean: name, history: rankHistory}], monthStates, time_scale: isDateSystem ? 'date' : 'month'});
      state.charts = [ratingChart, rankChart];
    }

    function destroyCharts() {
      state.charts.forEach(chart => {
        try { chart.destroy?.(); } catch (_) { /* 单个图表失败不阻塞其他区块 */ }
      });
      state.charts = [];
    }

    function bindTabs() {
      body.querySelectorAll('[data-system]').forEach(button => {
        button.addEventListener('click', () => {
          const systemId = button.dataset.system;
          // 与“当前请求选择”比较：切换途中仍可点回上一个体系，迟到响应不会覆盖。
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
          // 以“当前请求的体系”为准，避免切换途中的迟到点击用到旧体系范围。
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
      applyUrlState(readUrlState());
      fetchArchive();
    }

    function onThemeChange() {
      const theme = currentTheme();
      if (theme === state.theme) return;
      state.theme = theme;
      state.charts.forEach(chart => {
        try { chart.setOptions({theme}); } catch (_) { /* 忽略单个图表异常 */ }
      });
    }

    // 视口内再加载；深链接或锚点点击会立即加载。
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

    // URL 变化（后退/前进）恢复体系、范围与分页，不覆盖其他参数。
    window.addEventListener('popstate', onPopState);
    if (typeof MutationObserver !== 'undefined' && document.body) {
      state.themeObserver = new MutationObserver(onThemeChange);
      state.themeObserver.observe(document.body, {attributes: true, attributeFilter: ['data-theme']});
    }

    if (!playerId) {
      shell.dataset.ratingsState = 'unlinked';
      setBadge('缺少棋手参数', 'error');
      body.innerHTML = '<p class="player-ratings-notice" role="alert">缺少棋手参数，无法加载等级分档案。</p>';
    } else {
      setupLazyLoad();
    }

    return instance;
  }

  function mount(container, options) {
    if (!container) {
      return {destroy() {}, refresh() {}, load() {}, getState() { return null; }};
    }
    const previous = instances.get(container);
    if (previous) previous.destroy();
    const instance = createInstance(container, options || {});
    instances.set(container, instance);
    return instance;
  }

  window.GoViewerPlayerRatings = {mount};
})();
