/* 赛事目录：快捷分类、按条件联动的搜索选框、关键字与年份筛选、默认倒序排列；只读取页面资料，不写入赛事记录。 */
(function (root) {
  'use strict';
  const categories = [
    {id: 'all', label: '全部赛事', hint: ''},
    {id: 'world', label: '世界大赛', hint: ''},
    {id: 'women_world', label: '女子世界大赛', hint: ''},
    {id: 'international', label: '其他国际赛事', hint: ''},
    {id: 'domestic', label: '国内赛事', hint: ''}
  ];
  const typeLabels = {individual: '个人赛', team: '团体赛'};
  const countries = [{id:'all',label:'全部地区'},{id:'CHN',label:'中国棋战'},{id:'JPN',label:'日本棋战'},{id:'KOR',label:'韩国棋战'},{id:'TWN',label:'台湾棋战'}];
  const categoryOf = item => item.category || 'world';
  function countryOf(item, allData) {
    if (categoryOf(item) !== 'domestic') return null;
    if (item.domestic_country) return item.domestic_country;
    const t = allData[item.id]?.tournament || {}, id = item.tournament_id || '';
    if (id.startsWith('tw_') || id === 'xinrenwang_tw' || /台湾|台灣|海峰棋院/.test((item.tournament_name || '') + (t.host_associations || ''))) return 'TWN';
    if (id.startsWith('jp_') || /^日本/.test(item.tournament_name) || /日本棋院|关西棋院/.test(t.host_associations || '')) return 'JPN';
    if (id.startsWith('kr_') || id === 'kb' || /^韩国/.test(item.tournament_name) || /韩国棋院/.test(t.host_associations || '')) return 'KOR';
    if (/^中国|^全国/.test(item.tournament_name) || /中国围棋协会|海峰棋院/.test(t.host_associations || '')) return 'CHN';
    return null;
  }
  // 与现有对阵呈现一致；同一赛事不同届次可以采用不同形式。
  const typeOf = (item, allData) => item.competition_type === 'team' || (allData[item.id] && root.GoViewerModel.isTeamCompetition(allData[item.id], item))
    ? 'team' : 'individual';
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

  function matchesEditionQuery(item, normalizedQuery) {
    if (!normalizedQuery) return true;
    const editionLabel = item.edition_number != null && item.edition_number !== '' ? `第${item.edition_number}届` : '';
    const fields = [
      item.year != null ? `${item.year}年` : '',
      item.year,
      editionLabel,
      item.tournament_short,
      item.tournament_name,
      item.tournament_id,
      item.champion,
      item.runner_up,
      item.id,
    ];
    return fields.some(value => normalizeText(value).includes(normalizedQuery));
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
    return indexList.filter(item => {
      if (state.category !== 'all' && categoryOf(item) !== state.category) return false;
      if (state.country && state.country !== 'all' && countryOf(item, allData) !== state.country) return false;
      if (state.tournament !== 'all' && item.tournament_id !== state.tournament) return false;
      if (state.competitionType !== 'all' && typeOf(item, allData) !== state.competitionType) return false;
      if (state.status !== 'all'
        && (item.status || allData[item.id]?.tournament.status) !== (state.status === 'closed' ? 'defunct' : 'active')) return false;
      if (yearFrom !== null && (!Number(item.year) || Number(item.year) < yearFrom)) return false;
      if (yearTo !== null && (!Number(item.year) || Number(item.year) > yearTo)) return false;
      if (normalizedQuery && !matchesEditionQuery(item, normalizedQuery)) return false;
      return true;
    }).sort((a, b) => compareEditions(a, b, sort));
  }

  function create({indexList, allData, getState, onChange}) {
    const esc = root.GoViewerModel.escape;
    const categoryControl = document.getElementById('categoryFilter');
    const countryControl = document.getElementById('domesticCountryFilter');
    const picker = document.getElementById('tournamentPicker');
    const trigger = document.getElementById('tournamentFilter');
    const panel = document.getElementById('tournamentPickerPanel');
    const search = document.getElementById('tournamentPickerSearch');
    const results = document.getElementById('tournamentPickerResults');
    const typeControl = document.getElementById('competitionTypeFilter');
    const queryInput = document.getElementById('catalogQueryInput');
    const yearFromInput = document.getElementById('catalogYearFrom');
    const yearToInput = document.getElementById('catalogYearTo');
    const sortToggle = document.getElementById('catalogSortToggle');
    const chips = document.getElementById('catalogActiveFilters');
    const countTournaments = list => new Set(list.map(item => item.tournament_id)).size;
    let query = '';

    categoryControl.innerHTML = categories.map(category => `<button class="category-shortcut" type="button" data-category="${category.id}" aria-pressed="false" title="${category.hint}"><span>${category.label}</span><span class="category-shortcut-count">0</span></button>`).join('');
    countryControl.innerHTML = countries.map(c => `<button class="category-shortcut" type="button" data-country="${c.id}" aria-pressed="false"><span>${c.label}</span><span class="category-shortcut-count">0</span></button>`).join('');

    function closePicker({restoreFocus = false} = {}) {
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger.focus();
    }

    function renderOptions() {
      const state = getState();
      const eligible = filterEditions(indexList, allData, {...state, tournament: 'all'});
      const groups = new Map();
      for (const item of eligible) {
        if (!groups.has(item.tournament_id)) {
          groups.set(item.tournament_id, {item, types: new Set(), editions: 0, maxYear: 0, minYear: 9999});
        }
        const group = groups.get(item.tournament_id);
        group.types.add(typeOf(item, allData));
        group.editions++;
        const y = Number(item.year) || 0;
        if (y > group.maxYear) group.maxYear = y;
        if (y && y < group.minYear) group.minYear = y;
      }
      const normalized = query.trim().toLocaleLowerCase().replace(/\s/g, '');
      const shown = [...groups.values()]
        .filter(({item}) =>
          [item.tournament_name, item.tournament_short, item.tournament_id].some(value => String(value || '').toLocaleLowerCase().replace(/\s/g, '').includes(normalized)))
        .sort((a, b) => (b.maxYear - a.maxYear) || (b.editions - a.editions)
          || String(a.item.tournament_short || a.item.tournament_name || '').localeCompare(
            String(b.item.tournament_short || b.item.tournament_name || ''), 'zh-Hans-CN'));
      const selected = state.tournament === 'all';
      results.innerHTML = `<button class="tournament-picker-option" type="button" data-tournament="all" aria-pressed="${selected}"><span>全部赛事</span><span class="tournament-picker-meta">${selected ? '<span aria-hidden="true">✓</span> ' : ''}${groups.size} 项</span></button>`;
      for (const category of categories.slice(1)) {
        const members = shown.filter(({item}) => categoryOf(item) === category.id);
        if (!members.length) continue;
        results.insertAdjacentHTML('beforeend', `<div class="tournament-picker-group">${category.label}<span>${members.length} 项</span></div>`);
        for (const {item, types, editions, maxYear, minYear} of members) {
          const isSelected = state.tournament === item.tournament_id;
          const label = item.tournament_short || item.tournament_name || item.tournament_id;
          const fullLabel = item.tournament_name || label;
          const span = maxYear ? (minYear < maxYear ? `${minYear}–${maxYear}` : `${maxYear}`) : '';
          const metaParts = [span, [...types].map(type => typeLabels[type]).join('／'), `${editions} 届`].filter(Boolean);
          results.insertAdjacentHTML('beforeend', `<button class="tournament-picker-option" type="button" data-tournament="${esc(item.tournament_id)}" aria-pressed="${isSelected}" title="${esc(fullLabel)}"><span class="tournament-picker-name">${esc(label)}</span><span class="tournament-picker-meta">${isSelected ? '<span aria-hidden="true">✓</span> ' : ''}${esc(metaParts.join(' · '))}</span></button>`);
        }
      }
      if (!shown.length) results.insertAdjacentHTML('beforeend', '<div class="catalog-empty">没有符合条件的赛事</div>');
      document.getElementById('tournamentPickerStatus').textContent = normalized ? `找到 ${shown.length} 项赛事` : `${shown.length} 项赛事可选`;
    }

    function openPicker() {
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      query = '';
      search.value = '';
      renderOptions();
      search.focus();
    }

    function refresh() {
      const state = getState();
      const base = filterEditions(indexList, allData, {...state, category: 'all', country: 'all', tournament: 'all'});
      document.getElementById('domesticCountrySection').hidden = state.category !== 'domestic';
      for (const button of countryControl.querySelectorAll('[data-country]')) {
        const country = button.dataset.country;
        const count = countTournaments(base.filter(item => categoryOf(item) === 'domestic' && (country === 'all' || countryOf(item, allData) === country)));
        button.setAttribute('aria-pressed', String((state.country || 'all') === country));
        button.querySelector('.category-shortcut-count').textContent = count;
      }
      for (const button of categoryControl.querySelectorAll('[data-category]')) {
        const category = button.dataset.category;
        const count = countTournaments(base.filter(item => category === 'all' || categoryOf(item) === category));
        button.setAttribute('aria-pressed', String(state.category === category));
        button.querySelector('.category-shortcut-count').textContent = count;
        button.setAttribute('aria-label', `${categories.find(item => item.id === category).label}，${count} 项赛事`);
      }
      const tournament = indexList.find(item => item.tournament_id === state.tournament);
      document.getElementById('tournamentFilterLabel').textContent = tournament ? tournament.tournament_short || tournament.tournament_name : '全部赛事';
      typeControl.value = state.competitionType;
      if (queryInput && queryInput.value !== (state.query || '')) queryInput.value = state.query || '';
      if (yearFromInput && yearFromInput.value !== String(state.yearFrom || '')) yearFromInput.value = String(state.yearFrom || '');
      if (yearToInput && yearToInput.value !== String(state.yearTo || '')) yearToInput.value = String(state.yearTo || '');
      if (sortToggle) {
        const asc = state.sort === 'asc';
        sortToggle.textContent = asc ? '最早 ↑' : '最新 ↓';
        sortToggle.setAttribute('aria-pressed', String(asc));
        const descLabel = asc ? '切换届次排序：当前最早优先（正序）' : '切换届次排序：当前最新优先（倒序）';
        sortToggle.title = descLabel;
        sortToggle.setAttribute('aria-label', descLabel);
      }
      const conditions = [];
      if (state.category !== 'all') conditions.push(['category', categories.find(item => item.id === state.category)?.label || state.category]);
      if (state.country && state.country !== 'all') conditions.push(['country', countries.find(c => c.id === state.country)?.label || state.country]);
      if (tournament) conditions.push(['tournament', tournament.tournament_short || tournament.tournament_name]);
      if (String(state.query || '').trim()) conditions.push(['query', `筛选：${String(state.query).trim()}`]);
      if (state.competitionType !== 'all') conditions.push(['competitionType', typeLabels[state.competitionType]]);
      const yf = parseYearBound(state.yearFrom), yt = parseYearBound(state.yearTo);
      if (yf !== null || yt !== null) {
        const range = yf !== null && yt !== null ? `${yf}–${yt}年` : (yf !== null ? `${yf}年起` : `${yt}年止`);
        conditions.push(['yearRange', range]);
      }
      if (state.status !== 'all') conditions.push(['status', state.status === 'closed' ? '停办赛事' : '现行赛事']);
      chips.innerHTML = conditions.map(([key, label]) => `<button type="button" class="catalog-filter-chip" data-clear-filter="${key}" aria-label="清除${esc(label)}筛选">${esc(label)}<span aria-hidden="true">×</span></button>`).join('');
      if (conditions.length > 1) chips.insertAdjacentHTML('beforeend', '<button class="catalog-reset" type="button" data-clear-filter="all">清除全部</button>');
      chips.hidden = !conditions.length;
      const filtered = filterEditions(indexList, allData, state);
      document.getElementById('catalogSummary').textContent = `${countTournaments(filtered)} 项赛事 · ${filtered.length} 届`;
      document.getElementById('sidebarCount').textContent = `${filtered.length} 届`;
      document.querySelectorAll('.aside-tab').forEach(tab => {
        const selected = tab.dataset.tab === state.status;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', String(selected));
      });
      if (!panel.hidden) renderOptions();
    }

    categoryControl.addEventListener('click', event => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      closePicker();
      onChange({category: button.dataset.category, country: 'all', tournament: 'all'});
    });
    countryControl.addEventListener('click', event => {
      const button = event.target.closest('[data-country]');
      if (!button) return;
      closePicker();
      onChange({category: 'domestic', country: button.dataset.country, tournament: 'all'});
    });
    trigger.addEventListener('click', () => panel.hidden ? openPicker() : closePicker());
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openPicker(); }
    });
    search.addEventListener('input', () => { query = search.value; renderOptions(); });
    results.addEventListener('click', event => {
      const button = event.target.closest('[data-tournament]');
      if (!button) return;
      closePicker({restoreFocus: true});
      onChange({tournament: button.dataset.tournament});
    });
    picker.addEventListener('keydown', event => {
      if (panel.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePicker({restoreFocus: true}); return; }
      const options = [...results.querySelectorAll('[data-tournament]')];
      const index = options.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options[next]?.focus();
      } else if ((event.key === 'Home' || event.key === 'End') && index >= 0) {
        event.preventDefault(); options[event.key === 'Home' ? 0 : options.length - 1]?.focus();
      } else if (event.key === 'Enter' && event.target === search) {
        event.preventDefault();
        (query.trim() ? options.find(option => option.dataset.tournament !== 'all') : options[0])?.click();
      }
    });
    document.addEventListener('pointerdown', event => { if (!picker.contains(event.target)) closePicker(); });
    picker.addEventListener('focusout', event => { if (!picker.contains(event.relatedTarget)) closePicker(); });
    typeControl.addEventListener('change', () => onChange({competitionType: typeControl.value}));
    if (queryInput) queryInput.addEventListener('input', () => onChange({query: queryInput.value}));
    if (yearFromInput) yearFromInput.addEventListener('input', () => onChange({yearFrom: yearFromInput.value}));
    if (yearToInput) yearToInput.addEventListener('input', () => onChange({yearTo: yearToInput.value}));
    if (sortToggle) sortToggle.addEventListener('click', () => {
      onChange({sort: getState().sort === 'asc' ? 'desc' : 'asc'});
    });
    chips.addEventListener('click', event => {
      const button = event.target.closest('[data-clear-filter]');
      if (!button) return;
      const key = button.dataset.clearFilter;
      const next = key === 'all'
        ? {category: 'all', country: 'all', tournament: 'all', competitionType: 'all', status: 'all', query: '', yearFrom: '', yearTo: ''}
        : key === 'category' ? {category: 'all', country: 'all'}
        : key === 'query' ? {query: ''}
        : key === 'yearRange' ? {yearFrom: '', yearTo: ''}
        : {[key]: 'all'};
      onChange(next);
      // The clicked chip is removed by refresh; keep keyboard focus in the filter controls.
      (key === 'category' || key === 'all' ? categoryControl.querySelector('[data-category="all"]')
        : key === 'country' ? countryControl.querySelector('[data-country="all"]')
        : key === 'query' ? queryInput
        : key === 'yearRange' ? yearFromInput
        : key === 'competitionType' ? typeControl
        : key === 'status' ? document.querySelector('[data-tab="all"]')
        : trigger)?.focus();
    });
    refresh();
    return {refresh, closePicker};
  }
  root.GoViewerCatalog = {create, filterEditions, compareEditions, countryOf};
})(typeof window === 'undefined' ? globalThis : window);
