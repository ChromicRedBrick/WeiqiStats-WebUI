/* 赛事目录：按需常用赛事（可自由配置）、最近查看、单赛事历届、多词组合检索与全量分页筛选。 */
(function (root) {
  'use strict';

  const FEATURED_KEY = 'go_featured_tournaments_v1';
  const RECENT_KEY = 'go_recent_editions_v1';
  const MAX_RECENT = 8;
  const ALL_PAGE_SIZE = 40;

  const categories = [
    {id: 'all', label: '全部赛事'},
    {id: 'world', label: '世界大赛'},
    {id: 'women_world', label: '女子世界大赛'},
    {id: 'international', label: '其他国际'},
    {id: 'domestic', label: '国内赛事'},
  ];
  const countries = [
    {id: 'all', label: '全部地区'},
    {id: 'CHN', label: '中国棋战'},
    {id: 'JPN', label: '日本棋战'},
    {id: 'KOR', label: '韩国棋战'},
    {id: 'TWN', label: '台湾棋战'},
  ];
  const statuses = [
    {id: 'all', label: '全部状态'},
    {id: 'active', label: '现行'},
    {id: 'closed', label: '停办'},
  ];
  const typeLabels = {individual: '个人赛', team: '团体赛', grouped: '分组赛'};

  const categoryOf = item => item.category || 'world';
  function countryOf(item, allData) {
    if (categoryOf(item) !== 'domestic') return null;
    if (item.domestic_country) return item.domestic_country;
    const t = (allData && allData[item.id]?.tournament) || {};
    const id = item.tournament_id || '';
    if (id.startsWith('tw_') || id === 'xinrenwang_tw' || /台湾|台灣|海峰棋院/.test((item.tournament_name || '') + (t.host_associations || ''))) return 'TWN';
    if (id.startsWith('jp_') || /^日本/.test(item.tournament_name) || /日本棋院|关西棋院/.test(t.host_associations || '')) return 'JPN';
    if (id.startsWith('kr_') || id === 'kb' || /^韩国/.test(item.tournament_name) || /韩国棋院/.test(t.host_associations || '')) return 'KOR';
    if (/^中国|^全国/.test(item.tournament_name) || /中国围棋协会|海峰棋院/.test(t.host_associations || '')) return 'CHN';
    return null;
  }

  const normalizeText = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
  const dateOf = item => String(item.end_date || item.start_date || '');

  function compareEditions(a, b, sort = 'desc') {
    const dir = sort === 'asc' ? 1 : -1;
    const ay = Number(a?.year) || 0, by = Number(b?.year) || 0;
    if (ay !== by) {
      if (!ay) return 1;
      if (!by) return -1;
      return (ay - by) * dir;
    }
    const ad = dateOf(a || {}), bd = dateOf(b || {});
    if (ad !== bd) {
      if (!ad) return 1;
      if (!bd) return -1;
      return ad.localeCompare(bd) * dir;
    }
    const as = Number(a?.seq ?? a?.chronological_order) || 0;
    const bs = Number(b?.seq ?? b?.chronological_order) || 0;
    if (as !== bs) return (as - bs) * dir;
    const ae = Number(a?.edition_number) || 0, be = Number(b?.edition_number) || 0;
    if (ae !== be) return (ae - be) * dir;
    return String(a?.id || '').localeCompare(String(b?.id || '')) * dir;
  }

  function sortEditions(list, sort = 'desc') {
    return (list || []).slice().sort((a, b) => compareEditions(a, b, sort));
  }

  function parseYearBound(value) {
    const raw = String(value ?? '').trim();
    if (!/^\d{4}$/.test(raw)) return null;
    return Number(raw);
  }

  function filterEditions(indexList, allData, state) {
    const normalizedQuery = normalizeText(state.query);
    const yearFrom = parseYearBound(state.yearFrom);
    const yearTo = parseYearBound(state.yearTo);
    const sort = state.sort === 'asc' ? 'asc' : 'desc';
    const typeOf = (item) => item.competition_type === 'team'
      || (allData && allData[item.id] && root.GoViewerModel.isTeamCompetition(allData[item.id], item))
      ? 'team' : (item.competition_type || 'individual');
    return (indexList || []).filter(item => {
      if (state.category && state.category !== 'all' && categoryOf(item) !== state.category) return false;
      if (state.country && state.country !== 'all' && countryOf(item, allData) !== state.country) return false;
      if (state.tournament && state.tournament !== 'all' && item.tournament_id !== state.tournament) return false;
      if (state.competitionType && state.competitionType !== 'all' && typeOf(item) !== state.competitionType) return false;
      if (state.status && state.status !== 'all') {
        const raw = String(item.status || allData?.[item.id]?.tournament?.status || '').toLowerCase();
        const isClosed = ['defunct', 'historical', 'completed', 'ended'].includes(raw);
        if (state.status === 'closed' ? !isClosed : raw !== 'active' && raw !== '进行中') return false;
      }
      if (yearFrom !== null && (!Number(item.year) || Number(item.year) < yearFrom)) return false;
      if (yearTo !== null && (!Number(item.year) || Number(item.year) > yearTo)) return false;
      if (normalizedQuery) {
        const editionLabel = item.edition_number != null && item.edition_number !== '' ? `第${item.edition_number}届` : '';
        const fields = [item.year != null ? `${item.year}年` : '', item.year, editionLabel,
          item.tournament_short, item.tournament_name, item.tournament_id, item.champion, item.runner_up, item.id];
        if (!fields.some(value => normalizeText(value).includes(normalizedQuery))) return false;
      }
      return true;
    }).sort((a, b) => compareEditions(a, b, sort));
  }

  function readStorageJson(key, fallback) {
    try {
      const raw = root.localStorage && root.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeStorageJson(key, value) {
    try {
      if (root.localStorage) root.localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function removeStorageKey(key) {
    try {
      if (root.localStorage) root.localStorage.removeItem(key);
    } catch (_) {}
  }

  function create({
    dataClient,
    boot,
    onSelectEdition,
    onTournamentEditions,
    getCurrentEditionId,
    getFlagSvg,
  }) {
    const M = root.GoViewerModel;
    const esc = M.escape;
    const flagHtml = nat => (typeof getFlagSvg === 'function' ? getFlagSvg(nat) : '');

    const searchInput = document.getElementById('catalogSearchInput');
    const filterToggle = document.getElementById('catalogFilterToggle');
    const filterBadge = document.getElementById('catalogFilterBadge');
    const filterPanel = document.getElementById('catalogFilterPanel');
    const categoryControl = document.getElementById('categoryFilter');
    const countrySection = document.getElementById('domesticCountrySection');
    const countryControl = document.getElementById('domesticCountryFilter');
    const statusControl = document.getElementById('catalogStatusFilter');
    const typeControl = document.getElementById('competitionTypeFilter');
    const yearFromInput = document.getElementById('catalogYearFrom');
    const yearToInput = document.getElementById('catalogYearTo');
    const filterSummary = document.getElementById('catalogSummary');
    const filterResetBtn = document.getElementById('catalogFilterReset');
    const filterCloseBtn = document.getElementById('catalogFilterClose');
    const activeFiltersEl = document.getElementById('catalogActiveFilters');
    const subheaderEl = document.getElementById('catalogSubheader');
    const ongoingGroup = document.getElementById('ongoingEditionsGroup');
    const ongoingList = document.getElementById('ongoingEditionsList');
    const ongoingCount = document.getElementById('ongoingEditionsCount');
    const listContainer = document.getElementById('editionList');
    const sidebarCountEl = document.getElementById('sidebarCount');

    let view = 'home'; // 'home' | 'tournament' | 'all' | 'search'
    let prevView = 'home';
    let editingFeatured = false;
    let featuredData = (boot && boot.featured) || null;
    let totalTournaments = featuredData ? Number(featuredData.total_tournaments || 0) : 0;
    let totalEditions = featuredData ? Number(featuredData.total_editions || 0) : 0;

    let activeTournamentId = '';
    let activeTournamentMeta = null;
    let activeTournamentEditions = [];
    let editionSort = 'desc';

    const defaultFilters = () => ({
      category: 'all',
      country: 'all',
      status: 'all',
      competitionType: 'all',
      yearFrom: '',
      yearTo: '',
      query: '',
      sort: 'recent',
    });
    let allFilters = defaultFilters();
    let allItems = [];
    let allPageMeta = {index: 1, size: ALL_PAGE_SIZE, total: 0, pages: 0, has_more: false};
    let allFacets = null;

    let searchQuery = '';
    let searchResult = {editions: [], tournaments: []};
    let searchActiveIdx = -1;
    let searchTimer = 0;
    let searchToken = 0;
    let searchLoading = false;

    let featuredAddQuery = '';
    let featuredAddResults = [];
    let featuredAddTimer = 0;
    let featuredAddToken = 0;

    let yearTimer = 0;
    let featuredToken = 0;
    let tournamentToken = 0;
    let allToken = 0;

    function readFeaturedPref() {
      const parsed = readStorageJson(FEATURED_KEY, null);
      if (parsed && parsed.custom && Array.isArray(parsed.ids)) {
        return {
          custom: true,
          ids: parsed.ids.filter(id => typeof id === 'string' && id),
        };
      }
      return {custom: false, ids: []};
    }

    function writeFeaturedPref(pref) {
      if (!pref || !pref.custom) {
        removeStorageKey(FEATURED_KEY);
      } else {
        writeStorageJson(FEATURED_KEY, {custom: true, ids: [...new Set(pref.ids)]});
      }
    }

    function readRecent() {
      const list = readStorageJson(RECENT_KEY, []);
      return Array.isArray(list) ? list.filter(item => item && item.id) : [];
    }

    function recordRecent(meta, data) {
      const edId = meta?.id || data?.edition?.id;
      if (!edId) return;
      const tid = meta?.tournament_id || data?.tournament?.id || '';
      const shortName = meta?.tournament_short || data?.tournament?.short_name || tid;
      const entry = {
        id: edId,
        tournament_id: tid,
        tournament_short: shortName,
        edition_number: meta?.edition_number ?? data?.edition?.edition_number ?? null,
        year: meta?.year ?? data?.edition?.year ?? null,
        champion: meta?.champion || data?.champion?.name_zh || '',
        champion_nat: meta?.champion_nat || data?.champion?.nationality || null,
        finals_score: meta?.finals_score || data?.edition?.finals_score || null,
      };
      const next = [entry, ...readRecent().filter(item => item.id !== edId)].slice(0, MAX_RECENT);
      writeStorageJson(RECENT_KEY, next);
      if (view === 'home' && !editingFeatured) renderHome();
    }

    function clearRecent() {
      removeStorageKey(RECENT_KEY);
      if (view === 'home') renderHome();
    }

    function pinnedIdSet() {
      const pref = readFeaturedPref();
      if (pref.custom) return new Set(pref.ids);
      return new Set((featuredData?.items || []).map(item => item.tournament_id));
    }

    function isPinned(tid) {
      return Boolean(tid && pinnedIdSet().has(tid));
    }

    async function togglePin(tid) {
      if (!tid) return;
      if (!featuredData && dataClient) {
        try { featuredData = await dataClient.catalogFeatured(readFeaturedPref()); } catch (_) {}
      }
      const pref = readFeaturedPref();
      const baseIds = pref.custom
        ? [...pref.ids]
        : (featuredData?.items || []).map(item => item.tournament_id);
      const idx = baseIds.indexOf(tid);
      if (idx >= 0) baseIds.splice(idx, 1);
      else baseIds.push(tid);
      const nextPref = {custom: true, ids: baseIds};
      writeFeaturedPref(nextPref);
      await loadFeatured({fresh: true, pref: nextPref});
      renderCurrentView();
    }

    async function moveFeatured(tid, delta) {
      const pref = readFeaturedPref();
      const baseIds = pref.custom
        ? [...pref.ids]
        : (featuredData?.items || []).map(item => item.tournament_id);
      const idx = baseIds.indexOf(tid);
      const target = idx + delta;
      if (idx < 0 || target < 0 || target >= baseIds.length) return;
      const [item] = baseIds.splice(idx, 1);
      baseIds.splice(target, 0, item);
      const nextPref = {custom: true, ids: baseIds};
      writeFeaturedPref(nextPref);
      await loadFeatured({fresh: true, pref: nextPref});
      renderCurrentView();
    }

    async function addFeatured(tid) {
      if (!tid) return;
      const pref = readFeaturedPref();
      const baseIds = pref.custom
        ? [...pref.ids]
        : (featuredData?.items || []).map(item => item.tournament_id);
      if (!baseIds.includes(tid)) baseIds.push(tid);
      const nextPref = {custom: true, ids: baseIds};
      writeFeaturedPref(nextPref);
      await loadFeatured({fresh: true, pref: nextPref});
      renderCurrentView();
    }

    async function resetFeaturedToDefault() {
      writeFeaturedPref({custom: false, ids: []});
      await loadFeatured({fresh: true, pref: {custom: false, ids: []}});
      renderCurrentView();
    }

    function initFilterButtons() {
      if (categoryControl) {
        categoryControl.innerHTML = categories.map(cat =>
          `<button class="category-shortcut" type="button" data-category="${cat.id}" aria-pressed="false"><span>${cat.label}</span><span class="category-shortcut-count">0</span></button>`
        ).join('');
      }
      if (countryControl) {
        countryControl.innerHTML = countries.map(c =>
          `<button class="category-shortcut" type="button" data-country="${c.id}" aria-pressed="false"><span>${c.label}</span><span class="category-shortcut-count">0</span></button>`
        ).join('');
      }
      if (statusControl) {
        statusControl.innerHTML = statuses.map(st =>
          `<button class="category-shortcut" type="button" data-status="${st.id}" aria-pressed="false"><span>${st.label}</span><span class="category-shortcut-count">0</span></button>`
        ).join('');
      }
    }

    function activeFilterCount() {
      let count = 0;
      if (allFilters.category !== 'all') count++;
      if (allFilters.country !== 'all') count++;
      if (allFilters.status !== 'all') count++;
      if (allFilters.competitionType !== 'all') count++;
      if (parseYearBound(allFilters.yearFrom) !== null || parseYearBound(allFilters.yearTo) !== null) count++;
      if (String(allFilters.query || '').trim()) count++;
      return count;
    }

    function refreshFilterControls() {
      const count = activeFilterCount();
      if (filterBadge) {
        filterBadge.textContent = String(count);
        filterBadge.hidden = count === 0;
      }
      if (filterToggle) {
        filterToggle.classList.toggle('has-filters', count > 0);
      }
      if (countrySection) {
        countrySection.hidden = allFilters.category !== 'domestic';
      }
      const catCounts = allFacets?.category || {};
      const countryCounts = allFacets?.country || {};
      const statusCounts = allFacets?.status || {};

      categoryControl?.querySelectorAll('[data-category]').forEach(btn => {
        const id = btn.dataset.category;
        const val = catCounts[id] ?? 0;
        btn.setAttribute('aria-pressed', String(allFilters.category === id));
        const span = btn.querySelector('.category-shortcut-count');
        if (span) span.textContent = String(val);
      });
      countryControl?.querySelectorAll('[data-country]').forEach(btn => {
        const id = btn.dataset.country;
        const val = countryCounts[id] ?? 0;
        btn.setAttribute('aria-pressed', String(allFilters.country === id));
        const span = btn.querySelector('.category-shortcut-count');
        if (span) span.textContent = String(val);
      });
      statusControl?.querySelectorAll('[data-status]').forEach(btn => {
        const id = btn.dataset.status;
        const val = statusCounts[id] ?? 0;
        btn.setAttribute('aria-pressed', String(allFilters.status === id));
        const span = btn.querySelector('.category-shortcut-count');
        if (span) span.textContent = String(val);
      });
      if (typeControl && typeControl.value !== allFilters.competitionType) {
        typeControl.value = allFilters.competitionType;
      }
      if (yearFromInput && document.activeElement !== yearFromInput && !yearTimer && yearFromInput.value !== String(allFilters.yearFrom || '')) {
        yearFromInput.value = String(allFilters.yearFrom || '');
      }
      if (yearToInput && document.activeElement !== yearToInput && !yearTimer && yearToInput.value !== String(allFilters.yearTo || '')) {
        yearToInput.value = String(allFilters.yearTo || '');
      }
      if (filterSummary) {
        filterSummary.textContent = `${allPageMeta.total || 0} 项赛事`;
      }

      if (activeFiltersEl) {
        const chips = [];
        if (allFilters.category !== 'all') {
          chips.push(['category', categories.find(c => c.id === allFilters.category)?.label || allFilters.category]);
        }
        if (allFilters.country !== 'all') {
          chips.push(['country', countries.find(c => c.id === allFilters.country)?.label || allFilters.country]);
        }
        if (allFilters.status !== 'all') {
          chips.push(['status', allFilters.status === 'closed' ? '停办赛事' : '现行赛事']);
        }
        if (allFilters.competitionType !== 'all') {
          chips.push(['competitionType', typeLabels[allFilters.competitionType] || allFilters.competitionType]);
        }
        const yf = parseYearBound(allFilters.yearFrom);
        const yt = parseYearBound(allFilters.yearTo);
        if (yf !== null || yt !== null) {
          const label = yf !== null && yt !== null ? `${yf}–${yt}年` : (yf !== null ? `${yf}年起` : `${yt}年止`);
          chips.push(['yearRange', label]);
        }
        if (String(allFilters.query || '').trim()) {
          chips.push(['query', `筛选：${String(allFilters.query).trim()}`]);
        }
        activeFiltersEl.innerHTML = chips.map(([key, label]) =>
          `<button type="button" class="catalog-filter-chip" data-clear-filter="${key}" aria-label="清除${esc(label)}筛选">${esc(label)}<span aria-hidden="true">×</span></button>`
        ).join('') + (chips.length > 1 ? '<button class="catalog-reset" type="button" data-clear-filter="all">清除全部</button>' : '');
        activeFiltersEl.hidden = !chips.length;
      }
    }

    function openFilterPanel() {
      if (!filterPanel) return;
      filterPanel.hidden = false;
      filterToggle?.setAttribute('aria-expanded', 'true');
      if (!allFacets) {
        loadAll(1, false, {renderList: false}).catch(() => {});
      }
    }

    function closeFilterPanel({restoreFocus = false} = {}) {
      if (!filterPanel || filterPanel.hidden) return;
      filterPanel.hidden = true;
      filterToggle?.setAttribute('aria-expanded', 'false');
      if (restoreFocus) filterToggle?.focus();
    }

    function formatYearSpan(t) {
      if (!t.max_year) return '';
      if (t.min_year && t.min_year < t.max_year) return `${t.min_year}–${t.max_year}`;
      return `${t.max_year}`;
    }

    function formatTournamentLatestBadge(t) {
      const parts = [];
      if (t.latest_edition_number != null && t.latest_edition_number !== '') {
        parts.push(`第${t.latest_edition_number}届`);
      }
      if (t.latest_year) parts.push(`${t.latest_year}`);
      return parts.join(' · ');
    }

    function renderOngoingGroup() {
      if (!ongoingGroup || !ongoingList) return;
      const ongoing = featuredData?.ongoing_editions ?? sortEditions(
        (root.TOURNAMENTS_INDEX || []).filter(item => M.isMainOngoing(item, root.ALL_TOURNAMENTS_DATA)),
      );
      ongoingGroup.hidden = view !== 'home' || !ongoing.length;
      if (ongoingGroup.hidden) return;
      ongoingCount.textContent = String(ongoing.length);
      const activeId = getCurrentEditionId?.();
      const markup = ongoing.map(item => {
        const active = item.id === activeId;
        const name = `${item.tournament_short || item.tournament_name} ${M.editionLabel(item)}`;
        return `<button type="button" class="ongoing-edition-chip${active ? ' active' : ''}"
          data-ongoing-id="${esc(item.id)}"${active ? ' aria-current="true"' : ''}>
          <span class="ongoing-chip-dot" aria-hidden="true"></span><span class="ongoing-chip-name">${esc(name)}</span>
        </button>`;
      }).join('');
      const focused = ongoingList.contains(document.activeElement) ? document.activeElement.dataset.ongoingId : null;
      ongoingList.innerHTML = markup;
      if (focused) {
        const button = Array.from(ongoingList.children).find(item => item.dataset.ongoingId === focused);
        button?.focus({preventScroll: true});
      }
    }

    function renderSubheader() {
      renderOngoingGroup();
      if (!subheaderEl) return;
      if (view === 'home') {
        subheaderEl.hidden = true;
        subheaderEl.innerHTML = '';
        return;
      }
      subheaderEl.hidden = false;
      if (view === 'tournament') {
        const shortName = activeTournamentMeta?.tournament_short || activeTournamentEditions[0]?.tournament_short || activeTournamentId || '历届赛事';
        const fullName = activeTournamentMeta?.tournament_name || shortName;
        const pinned = isPinned(activeTournamentId);
        const asc = editionSort === 'asc';
        const backLabel = prevView === 'all' ? '← 全部赛事' : '← 常用';
        subheaderEl.innerHTML = `
          <button type="button" class="catalog-back-btn" id="catalogBackBtn">${esc(backLabel)}</button>
          <span class="catalog-sub-title" title="${esc(fullName)}">${esc(shortName)}</span>
          <button type="button" class="catalog-pin-btn" data-toggle-pin="${esc(activeTournamentId)}" aria-pressed="${pinned}" title="${pinned ? '移出常用赛事' : '加入常用赛事'}" aria-label="${pinned ? '移出常用赛事' : '加入常用赛事'}">${pinned ? '★' : '☆'}</button>
          <button type="button" class="aside-sort-btn" id="catalogSortToggle" aria-pressed="${asc}" title="${asc ? '切换届次排序：当前最早优先' : '切换届次排序：当前最新优先'}">${asc ? '最早 ↑' : '最新 ↓'}</button>
        `;
      } else if (view === 'all') {
        subheaderEl.innerHTML = `
          <button type="button" class="catalog-back-btn" id="catalogBackBtn">← 常用</button>
          <span class="catalog-sub-title">全部赛事</span>
          <select id="catalogAllSort" class="catalog-sort-select" aria-label="全部赛事排序">
            <option value="recent"${allFilters.sort === 'recent' ? ' selected' : ''}>最新举办</option>
            <option value="editions"${allFilters.sort === 'editions' ? ' selected' : ''}>届数最多</option>
            <option value="name"${allFilters.sort === 'name' ? ' selected' : ''}>名称排序</option>
          </select>
        `;
      } else if (view === 'search') {
        const eds = searchResult.editions || [];
        const ts = searchResult.tournaments || [];
        subheaderEl.innerHTML = `
          <button type="button" class="catalog-back-btn" id="catalogSearchClearBtn">← 返回</button>
          <span class="catalog-sub-title">${searchLoading ? '正在搜索…' : `找到 ${eds.length} 届 · ${ts.length} 项赛事`}</span>
        `;
      }
    }

    function renderHome() {
      renderSubheader();
      refreshFilterControls();
      const items = featuredData?.items || [];
      const recent = readRecent();
      if (sidebarCountEl) {
        sidebarCountEl.textContent = totalTournaments ? `${totalTournaments} 项赛事` : '0 项赛事';
      }
      if (!totalTournaments && !items.length && !recent.length) {
        listContainer.innerHTML = '<div class="catalog-empty">当前暂无赛事资料。</div>';
        return;
      }

      const currentEd = typeof getCurrentEditionId === 'function' ? getCurrentEditionId() : '';
      let html = `
        <div class="catalog-section-head">
          <span>常用赛事${featuredData && !featuredData.is_default ? ' · 自定义' : ''}</span>
          <button type="button" class="catalog-section-action" id="catalogEditFeaturedBtn">${editingFeatured ? '完成' : '配置'}</button>
        </div>
      `;

      if (editingFeatured) {
        const pinSet = pinnedIdSet();
        html += `
          <div class="catalog-config-toolbar">
            <div class="catalog-config-add">
              <input type="search" id="catalogFeaturedAddInput" class="catalog-config-input" placeholder="输入赛事名添加…" value="${esc(featuredAddQuery)}" autocomplete="off" aria-label="搜索赛事加入常用">
              <div id="catalogFeaturedAddResults" class="catalog-config-results"${featuredAddQuery.trim() ? '' : ' hidden'}>
                ${featuredAddQuery.trim() ? (featuredAddResults.length ? featuredAddResults.map(t => {
                  const added = pinSet.has(t.tournament_id);
                  return `<button type="button" class="catalog-config-add-item" data-featured-add="${esc(t.tournament_id)}" ${added ? 'disabled' : ''}><span>${esc(t.tournament_short)}</span><small>${added ? '已加入' : '+ 添加'}</small></button>`;
                }).join('') : '<div class="catalog-empty">未找到匹配赛事</div>') : ''}
              </div>
            </div>
            <button type="button" class="btn btn-small" id="catalogFeaturedResetBtn">恢复默认</button>
          </div>
        `;
        html += items.length ? items.map((t, idx) => `
          <div class="catalog-config-row" data-tournament-id="${esc(t.tournament_id)}">
            <span class="catalog-config-name" title="${esc(t.tournament_name)}">${esc(t.tournament_short)}</span>
            <span class="catalog-config-actions">
              <button type="button" class="catalog-mini-btn" data-featured-move="-1" data-tid="${esc(t.tournament_id)}" ${idx === 0 ? 'disabled' : ''} aria-label="上移 ${esc(t.tournament_short)}" title="上移">↑</button>
              <button type="button" class="catalog-mini-btn" data-featured-move="1" data-tid="${esc(t.tournament_id)}" ${idx === items.length - 1 ? 'disabled' : ''} aria-label="下移 ${esc(t.tournament_short)}" title="下移">↓</button>
              <button type="button" class="catalog-mini-btn catalog-mini-remove" data-featured-remove="${esc(t.tournament_id)}" aria-label="移出 ${esc(t.tournament_short)}" title="移出">×</button>
            </span>
          </div>
        `).join('') : '<div class="catalog-empty">常用赛事已清空，可上方搜索添加或点“恢复默认”。</div>';
      } else {
        html += items.length ? items.map(t => {
          const isCurrent = t.tournament_id === activeTournamentId;
          const badge = formatTournamentLatestBadge(t);
          return `
            <div class="catalog-tournament-row${isCurrent ? ' is-active' : ''}" data-tournament-id="${esc(t.tournament_id)}">
              <button type="button" class="catalog-tournament-btn" data-open-tournament="${esc(t.tournament_id)}" title="${esc(t.tournament_name)}">
                <span class="catalog-tournament-main">
                  <span class="catalog-tournament-name">${esc(t.tournament_short)}${t.status_group === 'closed' ? '<span class="catalog-status-tag">停办</span>' : ''}</span>
                </span>
                ${badge ? `<span class="catalog-tournament-meta">${esc(badge)}</span>` : ''}
              </button>
              <button type="button" class="catalog-pin-btn" data-toggle-pin="${esc(t.tournament_id)}" aria-pressed="true" title="移出常用赛事" aria-label="移出 ${esc(t.tournament_short)}">★</button>
            </div>
          `;
        }).join('') : '<div class="catalog-empty">暂无常用赛事，可点击上方“配置”添加或恢复默认。</div>';
      }

      if (recent.length && !editingFeatured) {
        html += `
          <div class="catalog-section-head">
            <span>最近查看</span>
            <button type="button" class="catalog-section-action" id="catalogClearRecentBtn">清空</button>
          </div>
          <div class="catalog-recent-list">
            ${recent.map(item => `
              <button type="button" class="catalog-recent-row${item.id === currentEd ? ' active' : ''}" data-open-edition="${esc(item.id)}" data-tournament-id="${esc(item.tournament_id || '')}">
                <span class="catalog-recent-title">${esc(item.tournament_short)} ${esc(M.editionLabel(item))}</span>
                <span class="catalog-recent-meta">${esc([item.year ? `${item.year}年` : '', item.champion].filter(Boolean).join(' · ') || '—')}</span>
              </button>
            `).join('')}
          </div>
        `;
      }

      html += `
        <button type="button" class="catalog-all-entry" id="catalogAllEntryBtn">
          <span>全部赛事</span>
          <span class="catalog-all-count">${totalTournaments ? `共 ${totalTournaments} 项 ` : ''}→</span>
        </button>
      `;

      listContainer.innerHTML = html;
    }

    function renderTournamentEditions() {
      renderSubheader();
      refreshFilterControls();
      const items = activeTournamentEditions || [];
      if (sidebarCountEl) {
        sidebarCountEl.textContent = `${items.length} 届`;
      }
      if (!items.length) {
        listContainer.innerHTML = '<div class="catalog-empty">该赛事暂无已收录届次。</div>';
        return;
      }
      const currentEd = typeof getCurrentEditionId === 'function' ? getCurrentEditionId() : '';
      const fragment = document.createDocumentFragment();
      let previousYear = null;
      items.forEach(item => {
        if (item.year && item.year !== previousYear) {
          const year = document.createElement('div');
          year.className = 'edition-year';
          year.textContent = String(item.year);
          fragment.appendChild(year);
          previousYear = item.year;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'edition-item' + (item.id === currentEd ? ' active' : '');
        btn.dataset.id = item.id;
        if (item.id === currentEd) btn.setAttribute('aria-current', 'true');
        btn.innerHTML = `
          <span>
            <span class="edition-item-title">${esc(item.tournament_short)} ${esc(M.editionLabel(item))}</span>
            <span class="edition-item-sub">${item.champion ? flagHtml(item.champion_nat) : ''} ${esc(M.editionChampionText(item))}</span>
          </span>
          <span class="edition-item-badge">${esc(item.finals_score || '')}</span>
        `;
        fragment.appendChild(btn);
      });
      listContainer.replaceChildren(fragment);
    }

    function renderAllTournaments() {
      renderSubheader();
      refreshFilterControls();
      const total = allPageMeta.total || 0;
      if (sidebarCountEl) {
        sidebarCountEl.textContent = `${total} 项赛事`;
      }
      if (!allItems.length) {
        listContainer.innerHTML = '<div class="catalog-empty">没有符合筛选条件的赛事，请调整或重置筛选。</div>';
        return;
      }
      const pinSet = pinnedIdSet();
      const rowsHtml = allItems.map(t => {
        const pinned = pinSet.has(t.tournament_id);
        const span = formatYearSpan(t);
        const subParts = [span, `${t.edition_count} 届`, t.latest_champion ? `最新：${t.latest_champion}` : ''].filter(Boolean);
        return `
          <div class="catalog-tournament-row${t.tournament_id === activeTournamentId ? ' is-active' : ''}" data-tournament-id="${esc(t.tournament_id)}">
            <button type="button" class="catalog-tournament-btn" data-open-tournament="${esc(t.tournament_id)}" title="${esc(t.tournament_name)}">
              <span class="catalog-tournament-main">
                <span class="catalog-tournament-name">${esc(t.tournament_short)}${t.status_group === 'closed' ? '<span class="catalog-status-tag">停办</span>' : ''}</span>
                <span class="catalog-tournament-sub">${esc(subParts.join(' · '))}</span>
              </span>
            </button>
            <button type="button" class="catalog-pin-btn" data-toggle-pin="${esc(t.tournament_id)}" aria-pressed="${pinned}" title="${pinned ? '移出常用赛事' : '加入常用赛事'}" aria-label="${pinned ? '移出' : '加入'} ${esc(t.tournament_short)}">${pinned ? '★' : '☆'}</button>
          </div>
        `;
      }).join('');
      const moreHtml = allPageMeta.has_more
        ? `<button type="button" class="catalog-load-more" id="catalogLoadMoreBtn">加载更多（已显示 ${allItems.length} / ${total} 项）</button>`
        : '';
      listContainer.innerHTML = rowsHtml + moreHtml;
    }

    function renderSearchResults() {
      renderSubheader();
      refreshFilterControls();
      const eds = searchResult.editions || [];
      const ts = searchResult.tournaments || [];
      if (sidebarCountEl) {
        sidebarCountEl.textContent = searchLoading ? '搜索中' : `${eds.length + ts.length} 条结果`;
      }
      if (searchLoading && !eds.length && !ts.length) {
        listContainer.innerHTML = '<div class="catalog-empty">正在检索…</div>';
        return;
      }
      if (!eds.length && !ts.length) {
        listContainer.innerHTML = `
          <div class="catalog-empty">
            <p>未找到与“${esc(searchQuery)}”匹配的赛事或届次。</p>
            <button type="button" class="btn btn-small" id="catalogSearchFallbackAll">在全部赛事中查找</button>
          </div>
        `;
        return;
      }
      const pinSet = pinnedIdSet();
      let idx = 0;
      let html = '';
      if (eds.length) {
        html += '<div class="catalog-section-head"><span>直达届次</span></div>';
        html += eds.map(ed => {
          const active = idx === searchActiveIdx ? ' is-kbd-active' : '';
          const rowIdx = idx++;
          return `
            <button type="button" class="catalog-search-option edition-item${active}" data-search-opt="${rowIdx}" data-open-edition="${esc(ed.id)}" data-tournament-id="${esc(ed.tournament_id || '')}" data-id="${esc(ed.id)}">
              <span>
                <span class="edition-item-title">${esc(ed.tournament_short)} ${esc(M.editionLabel(ed))}${ed.edition_number != null && ed.year ? ` (${ed.year})` : ''}</span>
                <span class="edition-item-sub">${ed.champion ? flagHtml(ed.champion_nat) : ''} ${esc(M.editionChampionText(ed))}</span>
              </span>
              <span class="edition-item-badge">${esc(ed.finals_score || '')}</span>
            </button>
          `;
        }).join('');
      }
      if (ts.length) {
        html += '<div class="catalog-section-head"><span>匹配赛事</span></div>';
        html += ts.map(t => {
          const active = idx === searchActiveIdx ? ' is-kbd-active' : '';
          const rowIdx = idx++;
          const pinned = pinSet.has(t.tournament_id);
          const span = formatYearSpan(t);
          return `
            <div class="catalog-tournament-row">
              <button type="button" class="catalog-search-option catalog-tournament-btn${active}" data-search-opt="${rowIdx}" data-open-tournament="${esc(t.tournament_id)}" title="${esc(t.tournament_name)}">
                <span class="catalog-tournament-main">
                  <span class="catalog-tournament-name">${esc(t.tournament_short)}${t.status_group === 'closed' ? '<span class="catalog-status-tag">停办</span>' : ''}</span>
                  <span class="catalog-tournament-sub">${esc([span, `${t.edition_count} 届`].filter(Boolean).join(' · '))}</span>
                </span>
              </button>
              <button type="button" class="catalog-pin-btn" data-toggle-pin="${esc(t.tournament_id)}" aria-pressed="${pinned}" title="${pinned ? '移出常用赛事' : '加入常用赛事'}" aria-label="${pinned ? '移出' : '加入'} ${esc(t.tournament_short)}">${pinned ? '★' : '☆'}</button>
            </div>
          `;
        }).join('');
      }
      listContainer.innerHTML = html;
    }

    function renderCurrentView() {
      if (view === 'tournament') renderTournamentEditions();
      else if (view === 'all') renderAllTournaments();
      else if (view === 'search') renderSearchResults();
      else renderHome();
    }

    async function loadFeatured({fresh = false, pref = null} = {}) {
      if (!dataClient) return null;
      const token = ++featuredToken;
      const activePref = pref || readFeaturedPref();
      const payload = await dataClient.catalogFeatured({...activePref, fresh});
      if (token !== featuredToken) return payload;
      featuredData = payload;
      totalTournaments = Number(payload?.total_tournaments ?? totalTournaments) || 0;
      totalEditions = Number(payload?.total_editions ?? totalEditions) || 0;
      return payload;
    }

    async function loadTournament(tournamentId, {render = true, sort = editionSort} = {}) {
      if (!tournamentId || !dataClient) return [];
      const token = ++tournamentToken;
      let payload = null;
      try {
        payload = await dataClient.tournamentEditions(tournamentId, {sort});
      } catch (_) {
        payload = null;
      }
      if (token !== tournamentToken) return payload?.items || [];
      activeTournamentId = tournamentId;
      activeTournamentMeta = payload?.tournament || null;
      activeTournamentEditions = payload?.items || [];
      root.GoStatsBoot?.mergeIndex?.(activeTournamentEditions);
      if (typeof onTournamentEditions === 'function') {
        onTournamentEditions(tournamentId, activeTournamentEditions, activeTournamentMeta);
      }
      if (render && view === 'tournament') renderTournamentEditions();
      return activeTournamentEditions;
    }

    async function loadAll(page = 1, append = false, {renderList = true} = {}) {
      if (!dataClient) return null;
      const token = ++allToken;
      const payload = await dataClient.catalogTournaments({
        category: allFilters.category,
        country: allFilters.country,
        status: allFilters.status,
        form: allFilters.competitionType,
        year_from: parseYearBound(allFilters.yearFrom) ?? undefined,
        year_to: parseYearBound(allFilters.yearTo) ?? undefined,
        q: allFilters.query || undefined,
        sort: allFilters.sort || 'recent',
        page,
        page_size: ALL_PAGE_SIZE,
      });
      if (token !== allToken) return payload;
      allPageMeta = payload?.page || {index: page, size: ALL_PAGE_SIZE, total: 0, pages: 0, has_more: false};
      allFacets = payload?.facets || null;
      const nextItems = payload?.items || [];
      allItems = append ? [...allItems, ...nextItems] : nextItems;
      if (renderList && view === 'all') renderAllTournaments();
      else refreshFilterControls();
      return payload;
    }

    async function runCatalogSearch(raw, {autoOpenFirst = false} = {}) {
      const q = String(raw || '').trim();
      searchQuery = q;
      if (!q) {
        searchResult = {editions: [], tournaments: []};
        searchActiveIdx = -1;
        searchLoading = false;
        if (view === 'search') {
          view = prevView === 'search' ? 'home' : prevView;
          renderCurrentView();
        }
        return null;
      }
      if (view !== 'search') {
        prevView = view;
        view = 'search';
      }
      searchLoading = true;
      searchActiveIdx = -1;
      renderSearchResults();
      const token = ++searchToken;
      const payload = await dataClient.catalogSearch(q, 8).catch(() => ({editions: [], tournaments: []}));
      if (token !== searchToken || searchQuery !== q) return payload;
      searchLoading = false;
      searchResult = {
        editions: payload?.editions || payload?.items || [],
        tournaments: payload?.tournaments || [],
      };
      root.GoStatsBoot?.mergeIndex?.(searchResult.editions);
      const total = searchResult.editions.length + searchResult.tournaments.length;
      searchActiveIdx = total > 0 ? 0 : -1;
      renderSearchResults();
      if (autoOpenFirst && total > 0) {
        const firstOpt = listContainer.querySelector('[data-search-opt="0"]');
        firstOpt?.click();
      }
      return payload;
    }

    async function openHome() {
      editingFeatured = false;
      view = 'home';
      prevView = 'home';
      if (searchInput && searchInput.value) searchInput.value = '';
      searchQuery = '';
      if (!featuredData) await loadFeatured().catch(() => null);
      renderHome();
    }

    async function openTournament(tournamentId, activeEditionId, options = {}) {
      if (!tournamentId) return openHome();
      editingFeatured = false;
      if (view !== 'tournament' && view !== 'search') {
        prevView = view;
      } else if (options.fromAll) {
        prevView = 'all';
      }
      view = 'tournament';
      if (searchInput && searchInput.value && options.clearSearch !== false) {
        searchInput.value = '';
        searchQuery = '';
      }
      activeTournamentId = tournamentId;
      renderTournamentEditions();
      const items = await loadTournament(tournamentId, {render: true});
      if (options.loadLatest && items.length) {
        const yf = parseYearBound(allFilters.yearFrom);
        const yt = parseYearBound(allFilters.yearTo);
        const preferred = items.find(ed => {
          if (yf !== null && (!Number(ed.year) || Number(ed.year) < yf)) return false;
          if (yt !== null && (!Number(ed.year) || Number(ed.year) > yt)) return false;
          if (allFilters.competitionType !== 'all' && (ed.competition_type || 'individual') !== allFilters.competitionType) return false;
          return true;
        }) || items[0];
        if (preferred && typeof onSelectEdition === 'function') {
          onSelectEdition(preferred.id, {fromCatalog: true});
        }
      }
      return items;
    }

    async function openAll(filtersOverride = null) {
      editingFeatured = false;
      if (filtersOverride) {
        allFilters = {...allFilters, ...filtersOverride};
      }
      view = 'all';
      prevView = 'all';
      if (searchInput && searchInput.value) {
        searchInput.value = '';
        searchQuery = '';
      }
      renderAllTournaments();
      await loadAll(1, false);
    }

    async function syncActiveEdition(meta, options = {}) {
      if (!meta || !meta.id) return;
      renderOngoingGroup();
      if (!options.skipRecent) recordRecent(meta);
      const tid = meta.tournament_id;
      if (tid) {
        const needLoad = tid !== activeTournamentId || !activeTournamentEditions.length || !activeTournamentEditions.some(e => e.id === meta.id);
        if (options.openTournament) {
          if (view !== 'tournament') prevView = view === 'search' ? 'home' : view;
          view = 'tournament';
          activeTournamentId = tid;
          if (needLoad) {
            await loadTournament(tid, {render: true});
          } else {
            renderTournamentEditions();
          }
        } else if (needLoad) {
          await loadTournament(tid, {render: view === 'tournament'});
        } else if (view === 'tournament') {
          renderTournamentEditions();
        } else if (view === 'home') {
          renderHome();
        }
      }
    }

    async function invalidate() {
      featuredData = null;
      allFacets = null;
      await loadFeatured({fresh: true}).catch(() => null);
      if (activeTournamentId) {
        await loadTournament(activeTournamentId, {render: view === 'tournament'}).catch(() => null);
      }
      if (view === 'all') {
        await loadAll(1, false).catch(() => null);
      } else {
        renderCurrentView();
      }
    }

    function applyFilterChange(patch) {
      allFilters = {...allFilters, ...patch};
      if (patch.category !== undefined && patch.category !== 'domestic') {
        allFilters.country = 'all';
      }
      view = 'all';
      prevView = 'all';
      renderOngoingGroup();
      if (searchInput && searchInput.value) {
        searchInput.value = '';
        searchQuery = '';
      }
      refreshFilterControls();
      loadAll(1, false).catch(() => null);
    }

    function bindEvents() {
      initFilterButtons();

      ongoingList?.addEventListener('click', event => {
        const button = event.target.closest('[data-ongoing-id]');
        if (button) onSelectEdition?.(button.dataset.ongoingId, {fromCatalog: true, closeMobile: true});
      });

      filterToggle?.addEventListener('click', () => {
        if (!filterPanel) return;
        if (filterPanel.hidden) openFilterPanel();
        else closeFilterPanel();
      });
      filterCloseBtn?.addEventListener('click', () => closeFilterPanel({restoreFocus: true}));
      filterResetBtn?.addEventListener('click', () => {
        allFilters = defaultFilters();
        refreshFilterControls();
        if (view === 'all') loadAll(1, false).catch(() => null);
        else loadAll(1, false, {renderList: false}).catch(() => null);
      });

      categoryControl?.addEventListener('click', event => {
        const btn = event.target.closest('[data-category]');
        if (!btn) return;
        applyFilterChange({category: btn.dataset.category, country: 'all'});
      });
      countryControl?.addEventListener('click', event => {
        const btn = event.target.closest('[data-country]');
        if (!btn) return;
        applyFilterChange({category: 'domestic', country: btn.dataset.country});
      });
      statusControl?.addEventListener('click', event => {
        const btn = event.target.closest('[data-status]');
        if (!btn) return;
        applyFilterChange({status: btn.dataset.status});
      });
      typeControl?.addEventListener('change', () => {
        applyFilterChange({competitionType: typeControl.value});
      });
      const onYearChange = () => {
        clearTimeout(yearTimer);
        yearTimer = setTimeout(() => {
          yearTimer = 0;
          applyFilterChange({
            yearFrom: yearFromInput?.value || '',
            yearTo: yearToInput?.value || '',
          });
        }, 120);
      };
      yearFromInput?.addEventListener('input', onYearChange);
      yearToInput?.addEventListener('input', onYearChange);

      activeFiltersEl?.addEventListener('click', event => {
        const btn = event.target.closest('[data-clear-filter]');
        if (!btn) return;
        const key = btn.dataset.clearFilter;
        if (key === 'all') applyFilterChange(defaultFilters());
        else if (key === 'category') applyFilterChange({category: 'all', country: 'all'});
        else if (key === 'yearRange') applyFilterChange({yearFrom: '', yearTo: ''});
        else if (key === 'query') applyFilterChange({query: ''});
        else applyFilterChange({[key]: 'all'});
      });

      filterPanel?.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeFilterPanel({restoreFocus: true});
        }
      });

      searchInput?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const val = searchInput.value;
        if (!val.trim()) {
          runCatalogSearch('');
          return;
        }
        searchTimer = setTimeout(() => { runCatalogSearch(val); }, 120);
      });

      searchInput?.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (searchInput.value) {
            searchInput.value = '';
            runCatalogSearch('');
          } else {
            closeFilterPanel();
          }
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const opts = [...listContainer.querySelectorAll('[data-search-opt]')];
          if (!opts.length) return;
          event.preventDefault();
          const dir = event.key === 'ArrowDown' ? 1 : -1;
          searchActiveIdx = searchActiveIdx < 0
            ? (dir > 0 ? 0 : opts.length - 1)
            : (searchActiveIdx + dir + opts.length) % opts.length;
          opts.forEach((el, i) => el.classList.toggle('is-kbd-active', i === searchActiveIdx));
          opts[searchActiveIdx]?.scrollIntoView({block: 'nearest'});
          return;
        }
        if (event.key === 'Enter' && searchInput.value.trim()) {
          event.preventDefault();
          clearTimeout(searchTimer);
          const q = searchInput.value.trim();
          const opts = [...listContainer.querySelectorAll('[data-search-opt]')];
          if (!searchLoading && searchQuery === q && opts.length) {
            const target = opts[Math.max(0, searchActiveIdx)] || opts[0];
            target?.click();
          } else {
            runCatalogSearch(q, {autoOpenFirst: true});
          }
        }
      });

      subheaderEl?.addEventListener('click', event => {
        if (event.target.closest('#catalogBackBtn')) {
          if (view === 'tournament' && prevView === 'all') openAll();
          else openHome();
          return;
        }
        if (event.target.closest('#catalogSearchClearBtn')) {
          if (searchInput) searchInput.value = '';
          runCatalogSearch('');
          return;
        }
        if (event.target.closest('#catalogSortToggle')) {
          editionSort = editionSort === 'desc' ? 'asc' : 'desc';
          loadTournament(activeTournamentId, {render: true, sort: editionSort});
          return;
        }
        const pinBtn = event.target.closest('[data-toggle-pin]');
        if (pinBtn) {
          togglePin(pinBtn.dataset.togglePin);
        }
      });

      subheaderEl?.addEventListener('change', event => {
        const sortSel = event.target.closest('#catalogAllSort');
        if (sortSel) {
          allFilters.sort = sortSel.value || 'recent';
          loadAll(1, false);
        }
      });

      listContainer?.addEventListener('click', event => {
        const editBtn = event.target.closest('#catalogEditFeaturedBtn');
        if (editBtn) {
          editingFeatured = !editingFeatured;
          featuredAddQuery = '';
          featuredAddResults = [];
          renderHome();
          if (editingFeatured) document.getElementById('catalogFeaturedAddInput')?.focus();
          return;
        }
        const resetFeatBtn = event.target.closest('#catalogFeaturedResetBtn');
        if (resetFeatBtn) {
          resetFeaturedToDefault();
          return;
        }
        const moveBtn = event.target.closest('[data-featured-move]');
        if (moveBtn) {
          moveFeatured(moveBtn.dataset.tid, Number(moveBtn.dataset.featuredMove));
          return;
        }
        const removeBtn = event.target.closest('[data-featured-remove]');
        if (removeBtn) {
          togglePin(removeBtn.dataset.featuredRemove);
          return;
        }
        const addBtn = event.target.closest('[data-featured-add]');
        if (addBtn) {
          addFeatured(addBtn.dataset.featuredAdd);
          return;
        }
        const clearRecentBtn = event.target.closest('#catalogClearRecentBtn');
        if (clearRecentBtn) {
          clearRecent();
          return;
        }
        if (event.target.closest('#catalogAllEntryBtn')) {
          openAll();
          return;
        }
        if (event.target.closest('#catalogLoadMoreBtn')) {
          loadAll((allPageMeta.index || 1) + 1, true);
          return;
        }
        if (event.target.closest('#catalogSearchFallbackAll')) {
          const q = searchQuery;
          if (searchInput) searchInput.value = '';
          searchQuery = '';
          openAll({query: q});
          return;
        }
        const pinBtn = event.target.closest('[data-toggle-pin]');
        if (pinBtn) {
          event.stopPropagation();
          togglePin(pinBtn.dataset.togglePin);
          return;
        }
        const editionBtn = event.target.closest('[data-open-edition], .edition-item[data-id]');
        if (editionBtn) {
          const edId = editionBtn.dataset.openEdition || editionBtn.dataset.id;
          const tid = editionBtn.dataset.tournamentId || activeTournamentId;
          if (edId && typeof onSelectEdition === 'function') {
            onSelectEdition(edId, {fromCatalog: true, closeMobile: true});
            if (view !== 'tournament' && tid) {
              openTournament(tid, edId);
            }
          }
          return;
        }
        const tBtn = event.target.closest('[data-open-tournament]');
        if (tBtn) {
          const tid = tBtn.dataset.openTournament;
          const fromAll = view === 'all';
          openTournament(tid, '', {loadLatest: true, fromAll});
        }
      });

      listContainer?.addEventListener('input', event => {
        const addInput = event.target.closest('#catalogFeaturedAddInput');
        if (!addInput) return;
        featuredAddQuery = addInput.value;
        clearTimeout(featuredAddTimer);
        const q = featuredAddQuery.trim();
        const resultsBox = document.getElementById('catalogFeaturedAddResults');
        if (!q) {
          featuredAddResults = [];
          if (resultsBox) { resultsBox.innerHTML = ''; resultsBox.hidden = true; }
          return;
        }
        const token = ++featuredAddToken;
        featuredAddTimer = setTimeout(async () => {
          const payload = await dataClient.catalogTournaments({q, page_size: 8}).catch(() => ({items: []}));
          if (token !== featuredAddToken || !editingFeatured) return;
          featuredAddResults = payload?.items || [];
          const box = document.getElementById('catalogFeaturedAddResults');
          if (box) {
            const pinSet = pinnedIdSet();
            box.hidden = false;
            box.innerHTML = featuredAddResults.length ? featuredAddResults.map(t => {
              const added = pinSet.has(t.tournament_id);
              return `<button type="button" class="catalog-config-add-item" data-featured-add="${esc(t.tournament_id)}" ${added ? 'disabled' : ''}><span>${esc(t.tournament_short)}</span><small>${added ? '已加入' : '+ 添加'}</small></button>`;
            }).join('') : '<div class="catalog-empty">未找到匹配赛事</div>';
          }
        }, 120);
      });
    }

    bindEvents();

    return {
      openHome,
      openTournament,
      openAll,
      syncActiveEdition,
      recordRecent,
      invalidate,
      closeFilterPanel,
      currentTournamentEditions: () => activeTournamentEditions,
      activeTournamentId: () => activeTournamentId,
      state: () => ({view, activeTournamentId, editionSort, allFilters: {...allFilters}, totalTournaments, totalEditions}),
      initView: async ({mode = 'home', tournamentId = '', editionId = ''} = {}) => {
        if (!featuredData) await loadFeatured().catch(() => null);
        if (mode === 'tournament' && tournamentId) {
          view = 'tournament';
          activeTournamentId = tournamentId;
          await loadTournament(tournamentId, {render: true});
        } else {
          view = 'home';
          renderHome();
          if (tournamentId) {
            await loadTournament(tournamentId, {render: false});
          }
        }
      },
    };
  }

  root.GoViewerCatalog = {create, filterEditions, compareEditions, sortEditions, countryOf};
})(typeof window === 'undefined' ? globalThis : window);
