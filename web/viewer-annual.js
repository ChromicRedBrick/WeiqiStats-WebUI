/* 年度对局独立页（annual.html）：默认定位最新年份，按需服务端分页查询，
   不提供“全部年份”查询以控制大表开销；双模式（local-lazy / public）统一经由 GoStatsDataClient 访问。 */
(function () {
  'use strict';

  const M = window.GoViewerModel;
  const client = window.GoStatsDataClient;
  const flags = window.GoViewerFlags || {html: () => ''};
  if (!M || !client) return;

  const E = M.escape;
  const $ = id => document.getElementById(id);
  const PAGE_SIZE = 50;
  const QUICK_YEAR_LIMIT = 10;
  const VALID_STATUSES = new Set(['decided', 'no_result', 'scheduled', 'pending']);
  const VALID_SORTS = new Set(['date_desc', 'date_asc']);

  const state = {
    yearsData: null,
    tournaments: [],
    year: '',
    category: '',
    tournament: '',
    q: '',
    status: '',
    sgf: false,
    sort: 'date_desc',
    page: 1,
  };

  let requestToken = 0;
  let activeController = null;
  let queryTimer = 0;

  function formatNumber(n) {
    return Number(n || 0).toLocaleString('zh-CN');
  }

  function setStatus(message, tone = '') {
    const el = $('annualStatus');
    const retry = $('annualRetry');
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      el.removeAttribute('data-tone');
      if (retry) retry.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = message;
    if (tone) el.dataset.tone = tone;
    else el.removeAttribute('data-tone');
    if (retry) retry.hidden = tone !== 'error';
  }

  function validYearKeys() {
    const data = state.yearsData;
    const keys = new Set();
    if (!data) return keys;
    for (const item of data.years || []) {
      if (item && item.year != null) keys.add(String(item.year));
    }
    if (data.unknown && data.unknown.match_count > 0) {
      keys.add('unknown');
    }
    return keys;
  }

  function defaultYearKey() {
    const data = state.yearsData;
    if (!data) return '';
    if (data.default_year != null) return String(data.default_year);
    if (data.years && data.years.length) return String(data.years[0].year);
    if (data.unknown && data.unknown.match_count > 0) return 'unknown';
    return '';
  }

  function readUrlState() {
    const params = new URLSearchParams(window.location.search);
    const validYears = validYearKeys();
    const rawYear = (params.get('year') || '').trim().toLowerCase();
    const year = validYears.has(rawYear) ? rawYear : defaultYearKey();
    const category = (params.get('category') || '').trim();
    const tournament = (params.get('tournament') || '').trim();
    const q = (params.get('q') || '').trim();
    const rawStatus = (params.get('status') || '').trim();
    const status = VALID_STATUSES.has(rawStatus) ? rawStatus : '';
    const sgf = params.get('sgf') === '1';
    const rawSort = (params.get('sort') || '').trim();
    const sort = VALID_SORTS.has(rawSort) ? rawSort : 'date_desc';
    const parsedPage = parseInt(params.get('page') || '1', 10);
    const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
    return {year, category, tournament, q, status, sgf, sort, page};
  }

  function syncUrl(push = false) {
    const url = new URL(window.location.href);
    const entries = {
      year: state.year || '',
      category: state.category || '',
      tournament: state.tournament || '',
      q: state.q || '',
      status: state.status || '',
      sgf: state.sgf ? '1' : '',
      sort: state.sort !== 'date_desc' ? state.sort : '',
      page: state.page > 1 ? String(state.page) : '',
    };
    for (const [k, v] of Object.entries(entries)) {
      if (v) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    }
    if (url.search === window.location.search) return;
    try {
      if (push) history.pushState(null, '', url);
      else history.replaceState(null, '', url);
    } catch (_) {}
  }

  function populateCategoryOptions() {
    const select = $('annualCategory');
    if (!select) return;
    const seen = new Set();
    const categories = [];
    for (const t of state.tournaments) {
      if (t && t.category && !seen.has(t.category)) {
        seen.add(t.category);
        categories.push(t.category);
      }
    }
    const html = ['<option value="">全部大类</option>'];
    for (const cat of categories) {
      const label = typeof M.categoryLabel === 'function' ? M.categoryLabel(cat) : cat;
      html.push(`<option value="${E(cat)}">${E(label)}</option>`);
    }
    select.innerHTML = html.join('');
    select.value = state.category;
  }

  function populateTournamentOptions() {
    const select = $('annualTournament');
    if (!select) return;
    const cat = state.category;
    const filtered = cat
      ? state.tournaments.filter(t => t && t.category === cat)
      : state.tournaments;
    const html = ['<option value="">全部赛事</option>'];
    for (const t of filtered) {
      if (!t || !t.id) continue;
      const label = t.short_name || t.name_zh || t.id;
      html.push(`<option value="${E(t.id)}">${E(label)}</option>`);
    }
    select.innerHTML = html.join('');
    if (state.tournament && !filtered.some(t => t && t.id === state.tournament)) {
      state.tournament = '';
    }
    select.value = state.tournament;
  }

  function renderYearControls() {
    const data = state.yearsData;
    const select = $('annualYearSelect');
    const chips = $('annualYearChips');
    if (!data || !select || !chips) return;

    const years = data.years || [];
    const options = years.map(item => {
      const key = String(item.year);
      return `<option value="${E(key)}">${E(key)} 年（${formatNumber(item.match_count)} 局）</option>`;
    });
    if (data.unknown && data.unknown.match_count > 0) {
      options.push(`<option value="unknown">年份未知（${formatNumber(data.unknown.match_count)} 局）</option>`);
    }
    select.innerHTML = options.join('') || '<option value="">暂无年份记录</option>';
    select.value = state.year;
    select.disabled = options.length === 0;

    const quickItems = years.slice(0, QUICK_YEAR_LIMIT);
    chips.innerHTML = quickItems.map(item => {
      const key = String(item.year);
      const active = key === state.year;
      return `<button type="button" class="annual-year-chip${active ? ' is-active' : ''}" data-annual-year="${E(key)}" aria-pressed="${active ? 'true' : 'false'}">${E(key)}<span class="annual-year-chip-count">${formatNumber(item.match_count)}</span></button>`;
    }).join('');

    renderYearHeading();
  }

  function renderYearHeading() {
    const data = state.yearsData;
    const heading = $('annualHeading');
    const statsEl = $('annualYearStats');
    if (!data || !heading || !statsEl) return;

    if (!state.year) {
      heading.textContent = '年度对局';
      statsEl.innerHTML = '';
      document.title = '年度对局 · 国际围棋赛事档案';
      return;
    }

    const isUnknown = state.year === 'unknown';
    const label = isUnknown ? '年份未知对局' : `${state.year} 年对局`;
    heading.textContent = label;
    document.title = `${label} · 国际围棋赛事档案`;

    const info = isUnknown
      ? data.unknown
      : (data.years || []).find(item => String(item.year) === state.year);
    if (!info) {
      statsEl.innerHTML = '';
      return;
    }
    statsEl.innerHTML = [
      `<span class="annual-year-stat">共 <strong>${formatNumber(info.match_count)}</strong> 局</span>`,
      `<span class="annual-year-stat">涉及 <strong>${formatNumber(info.tournament_count)}</strong> 项赛事</span>`,
      `<span class="annual-year-stat">含棋谱 <strong>${formatNumber(info.sgf_count)}</strong> 局</span>`,
    ].join('');
  }

  function syncControlsFromState() {
    if ($('annualYearSelect')) $('annualYearSelect').value = state.year;
    if ($('annualCategory')) $('annualCategory').value = state.category;
    populateTournamentOptions();
    if ($('annualQuery')) $('annualQuery').value = state.q;
    if ($('annualStatusFilter')) $('annualStatusFilter').value = state.status;
    if ($('annualSort')) $('annualSort').value = state.sort;
    if ($('annualSgfOnly')) $('annualSgfOnly').checked = state.sgf;
    document.querySelectorAll('#annualYearChips .annual-year-chip').forEach(btn => {
      const active = btn.dataset.annualYear === state.year;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    renderYearHeading();
  }

  function playerCellHtml(player) {
    if (!player || !player.id) return '<span class="table-muted">—</span>';
    const flagHtml = player.nationality ? flags.html(player.nationality) : '';
    const href = `player.html?id=${encodeURIComponent(player.id)}`;
    return `<a class="annual-player-link" href="${href}">${flagHtml}${E(player.name_zh || player.id)}</a>`;
  }

  function editionCellHtml(item) {
    const meta = {
      id: item.edition_id,
      tournament_id: item.tournament_id,
      tournament_short: item.tournament_short || item.tournament_name || '',
      tournament_name: item.tournament_name || item.tournament_short || '',
      edition_number: item.edition_number ?? null,
      year: item.year ?? null,
    };
    const edLabel = M.editionLabel(meta);
    const title = [meta.tournament_short, edLabel].filter(Boolean).join(' ') || item.edition_id || '—';
    const href = `index.html?ed=${encodeURIComponent(item.edition_id || '')}`;
    return `<a class="annual-edition-link" href="${href}">${E(title)}</a>`;
  }

  function renderRows(payload) {
    const body = $('annualTableBody');
    const countEl = $('annualCount');
    const pageInfo = $('annualPageInfo');
    const prevBtn = $('annualPrev');
    const nextBtn = $('annualNext');
    if (!body) return;

    const items = (payload && payload.items) || [];
    const pageMeta = (payload && payload.page) || {index: state.page, size: PAGE_SIZE, total: items.length, pages: 1};
    const total = Number(pageMeta.total || 0);
    const pages = Math.max(1, Number(pageMeta.pages || Math.ceil(total / PAGE_SIZE) || 1));
    const currentPage = Math.min(Math.max(1, Number(pageMeta.index || state.page)), pages);
    state.page = currentPage;

    if (!items.length) {
      body.innerHTML = '<tr><td colspan="8" class="table-empty">当前年份下没有符合筛选条件的对局。</td></tr>';
    } else {
      body.innerHTML = items.map(item => {
        const players = M.participants(item);
        const status = M.matchStatus(item);
        const statusText = (M.STATUS_LABELS && M.STATUS_LABELS[status]) || status || '—';
        const resultText = M.matchResult(item) || '—';
        const dateText = M.dateLabel(item.date) || '—';
        const roundText = item.round_name || '—';
        const hasSgf = Boolean(item.has_sgf || (item.sgf && item.sgf.present));
        const locateHref = `index.html?ed=${encodeURIComponent(item.edition_id || '')}&match=${encodeURIComponent(item.id || '')}`;
        const sgfHref = `${locateHref}&tab=sgf`;
        const p1 = players[0];
        const p2 = players[1];
        return `<tr data-annual-match="${E(item.id)}" data-annual-edition="${E(item.edition_id)}">
          <td class="annual-date-cell" data-label="日期">${E(dateText)}</td>
          <td data-label="赛事／届次">${editionCellHtml(item)}</td>
          <td data-label="轮次">${E(roundText)}</td>
          <td data-label="黑方">${playerCellHtml(p1)}${item.black_player_id ? '<span class="table-flag">黑</span>' : ''}</td>
          <td data-label="白方">${playerCellHtml(p2)}${item.white_player_id ? '<span class="table-flag">白</span>' : ''}</td>
          <td class="annual-result-cell" data-label="赛果">${E(resultText)}</td>
          <td data-label="状态"><span class="table-status table-status-${E(status)}">${E(statusText)}</span></td>
          <td class="table-actions" data-label="操作">
            <a class="btn btn-sm" href="${locateHref}">定位</a>
            ${hasSgf ? `<a class="btn btn-sm" href="${sgfHref}" data-sgf-link="1">棋谱</a>` : ''}
          </td>
        </tr>`;
      }).join('');
    }

    if (countEl) countEl.textContent = `共 ${formatNumber(total)} 局`;
    if (pageInfo) pageInfo.textContent = `第 ${currentPage} / ${pages} 页`;
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= pages;
  }

  async function loadMatches() {
    if (!state.year) {
      renderRows({items: [], page: {index: 1, size: PAGE_SIZE, total: 0, pages: 1}});
      return;
    }
    if (activeController) {
      try { activeController.abort(); } catch (_) {}
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    activeController = controller;
    const token = ++requestToken;

    const params = client.isPublic ? {
      year: state.year,
      category: state.category || undefined,
      tournament: state.tournament || undefined,
      q: state.q || undefined,
      result: state.status || undefined,
      sgf_only: state.sgf ? '1' : undefined,
      sort: state.sort || 'date_desc',
      page: state.page,
      page_size: PAGE_SIZE,
    } : {
      year: state.year,
      category: state.category || undefined,
      tournament: state.tournament || undefined,
      q: state.q || undefined,
      status: state.status || undefined,
      only_with_sgf: state.sgf ? '1' : undefined,
      sort: state.sort || 'date_desc',
      page: state.page,
      page_size: PAGE_SIZE,
    };

    setStatus('正在加载对局列表…', 'loading');
    try {
      const payload = await client.search(params, controller ? {controller} : undefined);
      if (token !== requestToken) return;
      setStatus('');
      renderRows(payload);
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (token !== requestToken) return;
      setStatus(error && error.message ? error.message : '加载年度对局失败，请稍后重试。', 'error');
    }
  }

  function applyFilterChange({push = true, resetPage = true} = {}) {
    if (resetPage) state.page = 1;
    syncControlsFromState();
    syncUrl(push);
    loadMatches();
  }

  function bindEvents() {
    $('annualYearSelect')?.addEventListener('change', event => {
      state.year = event.target.value;
      applyFilterChange({push: true, resetPage: true});
    });

    $('annualYearChips')?.addEventListener('click', event => {
      const btn = event.target instanceof Element ? event.target.closest('[data-annual-year]') : null;
      if (!btn) return;
      const nextYear = btn.dataset.annualYear || '';
      if (!nextYear || nextYear === state.year) return;
      state.year = nextYear;
      applyFilterChange({push: true, resetPage: true});
    });

    $('annualCategory')?.addEventListener('change', event => {
      state.category = event.target.value;
      populateTournamentOptions();
      applyFilterChange({push: true, resetPage: true});
    });

    $('annualTournament')?.addEventListener('change', event => {
      state.tournament = event.target.value;
      applyFilterChange({push: true, resetPage: true});
    });

    $('annualQuery')?.addEventListener('input', event => {
      const nextQ = event.target.value.trim();
      clearTimeout(queryTimer);
      queryTimer = setTimeout(() => {
        if (nextQ === state.q) return;
        state.q = nextQ;
        applyFilterChange({push: false, resetPage: true});
      }, 240);
    });

    $('annualStatusFilter')?.addEventListener('change', event => {
      state.status = event.target.value;
      applyFilterChange({push: true, resetPage: true});
    });

    $('annualSort')?.addEventListener('change', event => {
      state.sort = VALID_SORTS.has(event.target.value) ? event.target.value : 'date_desc';
      applyFilterChange({push: true, resetPage: true});
    });

    $('annualSgfOnly')?.addEventListener('change', event => {
      state.sgf = Boolean(event.target.checked);
      applyFilterChange({push: true, resetPage: true});
    });

    $('annualReset')?.addEventListener('click', () => {
      state.category = '';
      state.tournament = '';
      state.q = '';
      state.status = '';
      state.sgf = false;
      state.sort = 'date_desc';
      applyFilterChange({push: true, resetPage: true});
    });

    $('annualPrev')?.addEventListener('click', () => {
      if (state.page <= 1) return;
      state.page -= 1;
      syncUrl(true);
      loadMatches();
      window.scrollTo({top: 0, behavior: 'smooth'});
    });

    $('annualNext')?.addEventListener('click', () => {
      state.page += 1;
      syncUrl(true);
      loadMatches();
      window.scrollTo({top: 0, behavior: 'smooth'});
    });

    $('annualRetry')?.addEventListener('click', () => {
      if (!state.yearsData) bootstrap();
      else loadMatches();
    });

    window.addEventListener('popstate', () => {
      if (!state.yearsData) return;
      Object.assign(state, readUrlState());
      syncControlsFromState();
      loadMatches();
    });

    window.addEventListener('go-stats:version-changed', () => {
      bootstrap(true);
    });
  }

  async function bootstrap(fresh = false) {
    setStatus('正在加载年度目录…', 'loading');
    try {
      const [yearsPayload, optionsPayload] = await Promise.all([
        client.annualYears(fresh ? {fresh: true} : undefined),
        client.catalogOptions().catch(() => ({tournaments: []})),
      ]);
      state.yearsData = yearsPayload || {default_year: null, years: [], unknown: {match_count: 0, sgf_count: 0, tournament_count: 0}};
      state.tournaments = (optionsPayload && optionsPayload.tournaments) || [];
      Object.assign(state, readUrlState());
      populateCategoryOptions();
      renderYearControls();
      syncControlsFromState();
      syncUrl(false);
      if (!state.year) {
        setStatus('当前暂无已收录的对局记录。', 'empty');
        renderRows({items: [], page: {index: 1, size: PAGE_SIZE, total: 0, pages: 1}});
        return;
      }
      await loadMatches();
    } catch (error) {
      setStatus(error && error.message ? error.message : '加载年度目录失败，请稍后重试。', 'error');
    }
  }

  function init() {
    bindEvents();
    bootstrap();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
