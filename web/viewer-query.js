/* Query view: filtered match table, pagination and two-way bracket location. */
(function () {
  const M = window.GoViewerModel, E = M.escape;
  const indexList = window.TOURNAMENTS_INDEX || [];
  const allData = window.ALL_TOURNAMENTS_DATA || {};
  const byId = new Map();
  let catalogOptionsLoading = null;
  const editionLoadingFor = new Set();

  function editionMetaFromData(id, data) {
    if (!data) return null;
    if (window.GoStatsBoot?.indexItemFromEdition) return window.GoStatsBoot.indexItemFromEdition(data);
    return {
      id: data.id || id,
      tournament_id: data.tournament_id || '',
      tournament_short: data.tournament_short || data.short_name || data.tournament_name || '',
      tournament_name: data.tournament_name || data.tournament_short || '',
      edition_number: data.edition_number ?? null,
      year: data.year ?? null,
      seq: data.seq ?? 0,
      category: data.category || '',
      domestic_country: data.domestic_country || null,
      status: data.status || '',
      champion: data.champion || '',
      runner_up: data.runner_up || '',
    };
  }

  function syncById() {
    byId.clear();
    for (const item of (window.TOURNAMENTS_INDEX || indexList)) {
      if (item && item.id) byId.set(item.id, item);
    }
    for (const [id, data] of Object.entries(allData)) {
      if (!byId.has(id) && data) {
        const meta = editionMetaFromData(id, data);
        if (meta && meta.id) byId.set(meta.id, meta);
      }
    }
  }
  syncById();
  const PAGE_SIZE = 100;
  let rows = [], page = 0, active = false, editionSynced = false, dirty = true, lastSourceKey = '';
  const dataClient = window.GoStatsDataClient || null;
  const publicMode = !!(dataClient && dataClient.isPublic);
  const lazyMode = !!(dataClient && (dataClient.isLazy || dataClient.isPublic));
  let serverTotal = null, serverToken = 0;
  let restoreScroll = null, restoringFilters = false;
  const tableFields = {
    q: 'tablePlayer', tournament: 'tableTournament', filter_ed: 'tableEdition', round: 'tableRound',
    round_dim: 'tableRoundDim', status: 'tableStatus', from: 'tableDateFrom', to: 'tableDateTo', sort: 'tableSort'
  };
  const RESULT_MAP = {decided: 'decided', no_result: 'no_result', scheduled: 'scheduled', pending: 'pending'};
  const SORT_MAP = {date_desc: 'date_desc', date_asc: 'date_asc', edition_desc: 'edition',
                    edition_asc: 'edition', round_asc: 'edition'};
  const $ = id => document.getElementById(id);

  function aliases() {
    return {ids: window.PLAYER_ID_ALIASES || {}, names: window.PLAYER_NAME_ALIASES || {}};
  }
  function statusLabel(status) { return M.STATUS_LABELS[status] || status; }
  function dateSpan(str) {
    if (!str) return null;
    const parts = String(str).trim().split('-');
    if (parts.length === 1 && /^\d{4}$/.test(parts[0])) {
      return [`${parts[0]}-01-01`, `${parts[0]}-12-31`];
    }
    if (parts.length === 2 && /^\d{4}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
      const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
      const last = new Date(y, m, 0).getDate();
      return [`${parts[0]}-${String(m).padStart(2, '0')}-01`, `${parts[0]}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`];
    }
    if (parts.length === 3 && /^\d{4}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1]) && /^\d{1,2}$/.test(parts[2])) {
      const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
      const iso = `${parts[0]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return [iso, iso];
    }
    return null;
  }
  function dateMatches(matchDate, fromStr, toStr, unknown) {
    if (!matchDate) {
      if (!fromStr && !toStr) return true;
      return Boolean(unknown);
    }
    const mSpan = dateSpan(matchDate);
    if (!mSpan) return Boolean(unknown);
    const [mMin, mMax] = mSpan;
    const fMin = fromStr ? (dateSpan(fromStr)?.[0] || null) : null;
    const fMax = toStr ? (dateSpan(toStr)?.[1] || null) : null;
    if (fMin && mMax < fMin) return false;
    if (fMax && mMin > fMax) return false;
    return true;
  }
  function useServerQuery() {
    if (publicMode) return true;
    if (!lazyMode) return false;
    const edition = $('tableEdition')?.value;
    return !(edition && allData[edition]);
  }
  function rebuild(singleEditionId) {
    if (publicMode) { dirty = false; return; }
    dirty = false;
    serverTotal = null;
    rows = [];
    const entries = (lazyMode && singleEditionId && allData[singleEditionId])
      ? [[singleEditionId, allData[singleEditionId]]]
      : Object.entries(allData);
    lastSourceKey = (lazyMode && singleEditionId && allData[singleEditionId]) ? singleEditionId : '*';
    for (const [editionId, data] of entries) {
      const meta = byId.get(editionId);
      if (!meta || !data) continue;
      for (const round of data.rounds || []) {
        for (const match of round.matches || []) {
          rows.push({
            editionId, meta, edition: data.edition, tournament: data.tournament,
            roundId: round.id, roundName: round.round_name, roundOrder: round.round_order,
            match, players: M.participants(match), status: M.matchStatus(match),
            date: M.dateKey(match.date) || '', sortDate: match.date || '',
            result: M.matchResult(match), code: match.bracket_code || ('第' + match.match_number + '局')
          });
        }
      }
    }
  }
  function filtered() {
    if (useServerQuery()) return rows.slice();   // 服务端已按同一条件筛选与排序
    const tournament = $('tableTournament').value;
    const edition = $('tableEdition').value;
    const round = $('tableRound').value;
    const roundDim = $('tableRoundDim') ? $('tableRoundDim').value : '';
    const query = $('tablePlayer').value.trim();
    const status = $('tableStatus').value;
    const sgfOnly = $('tableSgfOnly') ? $('tableSgfOnly').checked : false;
    const alias = aliases();
    const scopeRounds = edition ? new Set(scopedRounds(allData[edition]).map(r => r.id)) : null;
    const dimMatch = row => {
      if (!roundDim) return true;
      const dims = window.GoNumbering?.dimsForRound?.(row.roundId);
      if (!dims) return false;
      return ('phase:' + dims.phase) === roundDim || ('round:' + dims.roundCode) === roundDim;
    };
    let list = rows.filter(row =>
      (!tournament || row.meta.tournament_id === tournament) &&
      (!edition || row.editionId === edition) &&
      (!scopeRounds || scopeRounds.has(row.roundId)) &&
      (!round || row.roundId === round) &&
      (!status || row.status === status) &&
      (!sgfOnly || Boolean(row.match.has_sgf || row.match.sgf?.present)) &&
      dimMatch(row));
    if (query) {
      list = list.filter(row => row.players.some(p => p?.id && M.matchesPlayerQuery(p, query, alias))
        || M.matchesPlayerQuery({id: row.match.id, name_zh: row.match.id}, query, alias));
    }
    const dateFrom = $('tableDateFrom')?.value.trim();
    const dateTo = $('tableDateTo')?.value.trim();
    const dateUnknown = $('tableDateUnknown') ? $('tableDateUnknown').checked : true;
    if (dateFrom || dateTo || !dateUnknown) {
      list = list.filter(row => dateMatches(row.match.date, dateFrom, dateTo, dateUnknown));
    }
    const sort = $('tableSort').value;
    const cmp = {
      date_desc: (a, b) => (b.date || '').localeCompare(a.date || '') || b.meta.seq - a.meta.seq,
      date_asc: (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.meta.seq - b.meta.seq,
      edition_desc: (a, b) => b.meta.seq - a.meta.seq || (a.date || '').localeCompare(b.date || ''),
      edition_asc: (a, b) => a.meta.seq - b.meta.seq || (a.date || '').localeCompare(b.date || ''),
      round_asc: (a, b) => a.meta.seq - b.meta.seq || a.roundOrder - b.roundOrder || (a.match.match_number || 0) - (b.match.match_number || 0)
    }[sort] || ((a, b) => b.date.localeCompare(a.date));
    return list.slice().sort(cmp);
  }
  function flag(nat) { return nat ? window.GoViewerFlags.html(nat) : ''; }
  function playerCell(p) {
    if (!p?.id) return '<span class="table-muted">待定</span>';
    return `<button type="button" class="table-player" data-table-player="${E(p.id)}">${flag(p.nationality)}${E(p.name_zh || p.id)}</button>`;
  }
  function render() {
    if (active && !restoringFilters) window.dispatchEvent(new Event('go:table-filters-changed'));
    if (useServerQuery()) { rebuildPublic(); return; }
    serverToken++;
    $('tableSearchError').hidden = true;
    const ed = $('tableEdition')?.value || '';
    const neededKey = lazyMode && ed && allData[ed] ? ed : '*';
    if (dirty || serverTotal !== null || lastSourceKey !== neededKey) rebuild(ed);
    return renderLocal();
  }
  async function rebuildPublic() {
    if (!dataClient) return;
    const token = ++serverToken;
    const params = publicMode ? {
      q: $('tablePlayer').value.trim() || undefined,
      edition: $('tableEdition').value || undefined,
      tournament: $('tableTournament').value || undefined,
      round: $('tableRound').value || undefined,
      result: RESULT_MAP[$('tableStatus').value] || undefined,
      sgf_only: $('tableSgfOnly')?.checked ? '1' : undefined,
      date_from: $('tableDateFrom') && $('tableDateFrom').value.trim() || undefined,
      date_to: $('tableDateTo') && $('tableDateTo').value.trim() || undefined,
      sort: SORT_MAP[$('tableSort').value] || 'date_desc',
      page: page + 1,
      page_size: PAGE_SIZE
    } : {
      q: $('tablePlayer').value.trim() || undefined,
      edition: $('tableEdition').value || undefined,
      tournament: $('tableTournament').value || undefined,
      round: $('tableRound').value || undefined,
      round_dim: $('tableRoundDim') ? ($('tableRoundDim').value || undefined) : undefined,
      status: $('tableStatus').value || undefined,
      only_with_sgf: ($('tableSgfOnly') && $('tableSgfOnly').checked) ? '1' : undefined,
      date_from: $('tableDateFrom') && $('tableDateFrom').value.trim() || undefined,
      date_to: $('tableDateTo') && $('tableDateTo').value.trim() || undefined,
      include_unknown_date: ($('tableDateUnknown') && !$('tableDateUnknown').checked) ? '0' : undefined,
      sort: $('tableSort').value || 'date_desc',
      page: page + 1,
      page_size: PAGE_SIZE
    };
    $('tableSearchError').hidden = true;
    let payload;
    try {
      payload = await dataClient.search(params);
    } catch (error) {
      if (token !== serverToken) return;
      $('tableSearchError').hidden = false;
      return;
    }
    if (token !== serverToken) return;      // 旧响应不得覆盖新的筛选结果
    serverTotal = payload.page.total;
    rows = (payload.items || []).map(item => {
      const meta = byId.get(item.edition_id) || {
        id: item.edition_id, tournament_id: item.tournament_id,
        tournament_short: item.tournament_short, tournament_name: item.tournament_name,
        category: item.category, edition_number: item.edition_number,
        year: item.year, seq: item.edition_seq
      };
      const match = item;
      return {
        editionId: item.edition_id, meta,
        edition: {id: item.edition_id, year: item.year, edition_number: item.edition_number},
        tournament: {id: item.tournament_id, short_name: item.tournament_short,
                     name_zh: item.tournament_name, category: item.category},
        roundId: item.round_id, roundName: item.round_name || '',
        roundOrder: item.round_order || 0, match,
        players: M.participants(match), status: M.matchStatus(match),
        date: M.dateKey(match.date) || '', sortDate: match.date || '',
        result: M.matchResult(match),
        code: match.bracket_code || ('第' + match.match_number + '局')
      };
    });
    renderLocal();
  }
  function renderLocal() {
    const list = filtered();
    const totalCount = serverTotal == null ? list.length : serverTotal;
    const pages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    page = Math.min(Math.max(0, page), pages - 1);
    const slice = serverTotal == null ? list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE) : list;
    $('matchesTableBody').innerHTML = slice.map(row => {
      const m = row.match;
      const hasSgf = Boolean(m.has_sgf || m.sgf?.present);
      return `<tr data-table-match="${E(m.id)}" data-table-edition="${E(row.editionId)}" data-object-table="matches" data-object-id="${E(m.id)}" tabindex="0">
        <td>${E(row.meta.tournament_short)} ${E(M.editionLabel(row.meta))}<br><span class="table-muted">${row.meta.year}</span></td>
        <td>${E(row.roundName)}</td>
        <td>${E(row.code)}</td>
        <td>${playerCell(row.players[0])}${m.black_player_id ? '<span class="table-flag">黑</span>' : ''}</td>
        <td>${playerCell(row.players[1])}${m.white_player_id ? '<span class="table-flag">白</span>' : ''}</td>
        <td>${E(row.result)}</td>
        <td>${E(M.dateLabel(m.date))}</td>
        <td><span class="table-status table-status-${E(row.status)}">${E(statusLabel(row.status))}</span></td>
        <td class="table-actions">
          <button class="btn table-locate" type="button" data-locate-match="${E(m.id)}" data-locate-edition="${E(row.editionId)}">定位</button>
          ${hasSgf ? `<button class="btn table-sgf" type="button" data-sgf-match="${E(m.id)}" data-sgf-edition="${E(row.editionId)}">棋谱</button>` : ''}
        </td></tr>`;
    }).join('') || `<tr><td colspan="9" class="table-empty">没有符合筛选条件的对局。</td></tr>`;
    $('tableCount').textContent = `共 ${totalCount.toLocaleString('zh-CN')} 局`;
    $('tablePageInfo').textContent = `第 ${page + 1} / ${pages} 页`;
    $('tablePrev').disabled = page <= 0;
    $('tableNext').disabled = page >= pages - 1;
    if (restoreScroll) {
      const [top, left] = restoreScroll;
      $('tableView').querySelector('.table-scroll').scrollTo(left, top);
      if (window.matchMedia('(max-width: 760px)').matches) {
        $('tableView').closest('.app-container').scrollTop = restoreScroll[2] || 0;
      }
      restoreScroll = null;
    }
    return {list, slice, pages};
  }
  /* 赛段维度筛选：数据来自编号索引的登记维度（阶段／轮次码），不切割编号字符串。 */
  function populateRoundDims() {
    const select = $('tableRoundDim');
    if (!select) return;
    const previous = select.value;
    const index = window.__GO_NUMBERING__;
    const edition = $('tableEdition').value;
    const data = edition ? allData[edition] : null;
    const rounds = data ? (data.rounds || []).map(item => item.id)
      : Object.keys((index && index.rounds) || {});
    const phases = new Map();
    const codes = new Map();
    for (const roundId of rounds) {
      const dims = window.GoNumbering?.dimsForRound?.(roundId);
      if (!dims) continue;
      const labels = window.GoNumbering.dimensionOptions(dims.phase, dims.roundCode);
      phases.set(dims.phase, labels.phase);
      codes.set(dims.roundCode, labels.roundCode);
    }
    const group = (title, entries, prefix) => entries.length
      ? `<optgroup label="${E(title)}">` + [...entries]
        .map(([value, label]) => `<option value="${E(prefix + value)}">${E(label)}</option>`)
        .join('') + '</optgroup>'
      : '';
    select.innerHTML = '<option value="">全部赛段</option>' +
      group('阶段', [...phases], 'phase:') + group('轮次码', [...codes], 'round:');
    select.value = [...select.options].some(option => option.value === previous) ? previous : '';
  }
  function ensureCatalogOptions() {
    const dataClient = window.GoStatsDataClient;
    if (!dataClient || typeof dataClient.catalogOptions !== 'function') return Promise.resolve([]);
    const cached = dataClient.getCachedOptions?.();
    if (cached) return Promise.resolve(cached);
    if (catalogOptionsLoading) return catalogOptionsLoading;
    catalogOptionsLoading = dataClient.catalogOptions().then(res => {
      catalogOptionsLoading = null;
      const items = res?.tournaments || [];
      if (items.length && $('tableTournament')) populateTournaments();
      return items;
    }).catch(() => {
      catalogOptionsLoading = null;
      return [];
    });
    return catalogOptionsLoading;
  }

  function ensureTournamentOption(tid, label) {
    const select = $('tableTournament');
    if (!select || !tid) return;
    if (![...select.options].some(opt => opt.value === tid)) {
      const opt = document.createElement('option');
      opt.value = tid;
      opt.textContent = label || tid;
      select.appendChild(opt);
    }
  }

  function populateTournaments() {
    syncById();
    const select = $('tableTournament');
    if (!select) return;
    const previous = select.value;
    const seen = new Map();
    const options = window.GoStatsDataClient?.getCachedOptions?.();
    if (Array.isArray(options) && options.length) {
      for (const item of options) {
        if (item && item.id && !seen.has(item.id)) seen.set(item.id, item.short_name || item.name_zh || item.id);
      }
    }
    for (const item of byId.values()) {
      if (item && item.tournament_id && !seen.has(item.tournament_id)) {
        seen.set(item.tournament_id, item.tournament_short || item.tournament_name || item.tournament_id);
      }
    }
    select.innerHTML = '<option value="">全部赛事</option>' +
      [...seen].map(([id, name]) => `<option value="${E(id)}">${E(name)}</option>`).join('');
    if (previous && seen.has(previous)) select.value = previous;
    ensureCatalogOptions();
  }

  function populateEditions() {
    syncById();
    const tournament = $('tableTournament').value;
    const select = $('tableEdition');
    const previous = select.value;
    const list = [];
    const seenIds = new Set();
    const addItem = item => {
      if (!item || !item.id || seenIds.has(item.id)) return;
      seenIds.add(item.id);
      list.push(item);
    };
    const dataClient = window.GoStatsDataClient;
    if (tournament) {
      const cached = dataClient?.getCachedTournamentEditions?.(tournament);
      if (Array.isArray(cached)) cached.forEach(addItem);
      for (const item of byId.values()) {
        if (item.tournament_id === tournament) addItem(item);
      }
      if (!cached && dataClient && typeof dataClient.tournamentEditions === 'function' && !editionLoadingFor.has(tournament)) {
        editionLoadingFor.add(tournament);
        dataClient.tournamentEditions(tournament).then(res => {
          editionLoadingFor.delete(tournament);
          if (Array.isArray(res?.items) && res.items.length) {
            window.GoStatsBoot?.mergeIndex?.(res.items);
            syncById();
          }
          if ($('tableTournament')?.value === tournament) populateEditions();
        }).catch(() => {
          editionLoadingFor.delete(tournament);
        });
      }
    } else {
      for (const item of (window.TOURNAMENTS_INDEX || indexList)) addItem(item);
      if (previous && !seenIds.has(previous) && byId.has(previous)) addItem(byId.get(previous));
    }
    const sorted = window.GoViewerCatalog?.sortEditions ? window.GoViewerCatalog.sortEditions(list, 'desc') : list;
    select.innerHTML = '<option value="">全部届次</option>' + sorted.map(item =>
      `<option value="${E(item.id)}">${E(item.tournament_short)} ${E(M.editionLabel(item))}${item.edition_number != null ? `（${item.year}）` : ''}</option>`).join('');
    select.value = sorted.some(item => item.id === previous) ? previous : '';
    populateRounds();
    populateRoundDims();
  }
  function scopedRounds(data) {
    if (!data) return [];
    const hasPrelim = data.rounds.some(round => M.isPrelimRound(round));
    const scope = window.GoViewerScope?.current || 'main';
    if (hasPrelim && scope === 'prelim') return data.rounds.filter(r => M.isPrelimRound(r));
    if (scope === 'unclassified') return M.roundsForView(data).unclassifiedRounds;
    if (scope === 'main') return data.rounds.filter(r => !M.isPrelimRound(r) && (M.isTeamCompetition(data) || !M.isUnclassifiedRound(r)));
    return data.rounds;
  }
  function populateRounds() {
    const edition = $('tableEdition').value;
    const select = $('tableRound');
    const previous = select.value;
    const data = allData[edition];
    if (!data) {
      select.innerHTML = '<option value="">全部轮次</option>'; select.disabled = true;
      populateRoundStrip();
      if (edition && lazyMode && dataClient) {
        dataClient.ensureEdition(edition).then(loaded => {
          if (loaded && !allData[edition]) allData[edition] = loaded;
          if ($('tableEdition').value === edition && allData[edition]) {
            populateRounds();
            populateRoundDims();
          }
        }).catch(() => {});
      }
      return;
    }
    select.disabled = false;
    select.innerHTML = '<option value="">全部轮次</option>' + scopedRounds(data).map(round =>
      `<option value="${E(round.id)}">${E(round.round_name)}</option>`).join('');
    select.value = [...select.options].some(option => option.value === previous) ? previous : '';
    populateRoundStrip();
  }
  // Mobile-friendly round list: one tap filters the table to that round.
  function populateRoundStrip() {
    const strip = $('tableRounds');
    if (!strip) return;
    const edition = $('tableEdition').value, data = allData[edition];
    if (!data) { strip.innerHTML = ''; strip.hidden = true; return; }
    strip.hidden = false;
    const current = $('tableRound').value;
    strip.innerHTML = `<button type="button" class="round-chip${current ? '' : ' active'}" data-table-round="">全部轮次</button>` +
      scopedRounds(data).map(round => `<button type="button" class="round-chip${current === round.id ? ' active' : ''}" data-table-round="${E(round.id)}">${E(round.round_name)}<small>${round.matches.length}局</small></button>`).join('');
  }
  function routeFilters() {
    const state = Object.fromEntries(Object.entries(tableFields).map(([key, id]) => [key, $(id)?.value.trim() || '']));
    if (state.sort === 'date_desc') state.sort = '';
    return {...state, sgf: $('tableSgfOnly')?.checked ? '1' : '', unknown: $('tableDateUnknown')?.checked === false ? '0' : '',
      page: page > 0 ? String(page + 1) : ''};
  }
  function rememberPosition() {
    if (!active) return;
    const scroll = $('tableView').querySelector('.table-scroll');
    const container = $('tableView').closest('.app-container');
    history.replaceState({...history.state, tableScroll: [scroll.scrollTop, scroll.scrollLeft, container.scrollTop]}, '');
  }
  function show(options = {}) {
    active = true;
    document.getElementById('viewport').hidden = true;
    $('tableView').hidden = false;
    document.body.dataset.contentView = 'table';
    for (const button of document.querySelectorAll('[data-content]')) {
      button.classList.toggle('active', button.dataset.content === 'table');
    }
    restoringFilters = Boolean(options.fromRoute);
    const filters = options.route?.table;
    if (filters) {
      $('tableTournament').value = filters.tournament;
      populateEditions();
      $('tableEdition').value = filters.filter_ed;
      if (!allData[filters.filter_ed] && filters.filter_ed && lazyMode) {
        const select = $('tableEdition');
        dataClient.ensureEdition(select.value).then(data => {
          if (!active || select.value !== filters.filter_ed || location.search !== options.search) return;
          if (data) allData[filters.filter_ed] = data;
          populateRounds(); populateRoundDims();
          $('tableRound').value = filters.round;
          $('tableRoundDim').value = filters.round_dim;
          restoringFilters = true;
          render();
          restoringFilters = false;
        }).catch(() => {});
      }
      populateRounds(); populateRoundDims();
      for (const [key, id] of Object.entries(tableFields)) {
        if (key !== 'tournament' && key !== 'filter_ed' && $(id)) $(id).value = filters[key] || (key === 'sort' ? 'date_desc' : '');
      }
      if (!$('tableSort').value) $('tableSort').value = 'date_desc';
      $('tableSgfOnly').checked = filters.sgf === '1';
      $('tableDateUnknown').checked = filters.unknown !== '0';
      editionSynced = true;
    } else if (!editionSynced) {
      syncById();
      ensureCatalogOptions();
      const urlEdition = new URLSearchParams(location.search).get('ed') || window.GoViewerNavigate?.currentEdition?.();
      const targetMeta = urlEdition && (byId.get(urlEdition) || editionMetaFromData(urlEdition, allData[urlEdition]));
      if (urlEdition && (allData[urlEdition] || targetMeta)) {
        if (targetMeta?.tournament_id) ensureTournamentOption(targetMeta.tournament_id, targetMeta.tournament_short || targetMeta.tournament_name);
        $('tableTournament').value = targetMeta?.tournament_id || '';
        populateEditions();
        $('tableEdition').value = urlEdition;
        populateRounds();
      }
      editionSynced = true;
    }
    restoreScroll = options.fromRoute ? history.state?.tableScroll : null;
    page = Math.min(9999, Math.max(0, (parseInt(filters?.page, 10) || 1) - 1));
    render();
    restoringFilters = false;
    populateRoundStrip();
    window.dispatchEvent(new CustomEvent('go:content-view-changed', {
      detail: {view: 'table', fromRoute: Boolean(options && options.fromRoute), silentRoute: Boolean(options && options.silentRoute)},
    }));
  }
  function hide(options) {
    active = false;
    ++serverToken;
    document.getElementById('viewport').hidden = false;
    $('tableView').hidden = true;
    document.body.dataset.contentView = 'chart';
    for (const button of document.querySelectorAll('[data-content]')) {
      button.classList.toggle('active', button.dataset.content === 'chart');
    }
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('go:content-view-changed', {
      detail: {view: 'chart', fromRoute: Boolean(options && options.fromRoute), silentRoute: Boolean(options && options.silentRoute)},
    }));
  }
  function focusMatch(matchId, editionId, options) {
    const opts = options || {};
    if (editionId && !allData[editionId] && lazyMode && dataClient) {
      dataClient.ensureEdition(editionId).then(() => focusMatch(matchId, editionId, opts)).catch(() => {
        if (typeof opts.onSettled === 'function') opts.onSettled();
      });
      return false;
    }
    if (!editionId && lazyMode && dataClient && !rows.some(row => row.match.id === matchId)) {
      dataClient.search({q: matchId, page: 1, page_size: 5}).then(payload => {
        const hit = (payload.items || []).find(item => item.id === matchId);
        if (hit && hit.edition_id) focusMatch(matchId, hit.edition_id, opts);
        else if (typeof opts.onSettled === 'function') opts.onSettled();
      }).catch(() => {
        if (typeof opts.onSettled === 'function') opts.onSettled();
      });
      return false;
    }
    if (dirty || !rows.length || (editionId && lastSourceKey !== editionId)) rebuild(editionId);
    const target = rows.find(row => row.match.id === matchId);
    if (target) {
      editionId = target.editionId;
      if (window.GoViewerNavigate?.currentEdition() !== editionId) window.GoViewerNavigate?.loadEdition(editionId, {push: false});
      const prelim = M.isPrelimRound({id: target.roundId, round_name: target.roundName});
      const unknown = M.isUnclassifiedRound({id:target.roundId,round_name:target.roundName});
      $(prelim ? 'btnScopePrelim' : unknown ? 'btnScopeUnclassified' : 'btnScopeMain')?.click();
    }
    show({silentRoute: Boolean(opts.silentRoute)});
    if (editionId) {
      syncById();
      const targetMeta = byId.get(editionId) || editionMetaFromData(editionId, allData[editionId]);
      if (targetMeta?.tournament_id) ensureTournamentOption(targetMeta.tournament_id, targetMeta.tournament_short || targetMeta.tournament_name);
      $('tableTournament').value = targetMeta?.tournament_id || '';
      populateEditions();
      $('tableEdition').value = editionId;
      populateRounds();
    }
    $('tableRound').value = ''; $('tablePlayer').value = ''; $('tableStatus').value = '';
    const result = render();
    if (!result || useServerQuery()) {
      if (typeof opts.onSettled === 'function') opts.onSettled();
      return false;
    }
    const index = result.list.findIndex(row => row.match.id === matchId);
    if (index >= 0) {
      page = Math.floor(index / PAGE_SIZE);
      const second = render();
      const row = second.slice[index - page * PAGE_SIZE];
      const tr = document.querySelector(`#matchesTableBody tr[data-table-match="${CSS.escape(matchId)}"]`);
      if (tr) {
        tr.classList.add('table-row-located');
        tr.scrollIntoView({block: 'center'});
        tr.querySelector('.table-locate')?.focus();
        setTimeout(() => tr.classList.remove('table-row-located'), 2400);
      }
    }
    if (typeof opts.onSettled === 'function') opts.onSettled();
    return index >= 0;
  }
  function openQuery(query) {
    show();
    $('tableTournament').value = ''; populateEditions();
    $('tableEdition').value = ''; populateRounds();
    $('tableRound').value = ''; $('tableStatus').value = '';
    $('tablePlayer').value = query || '';
    page = 0; render();
  }
  function refresh() {
    syncById();
    populateTournaments();
    populateEditions();
    dirty = true;
    lastSourceKey = '';
    if (active) render();
  }
  function bind() {
    if (!$('tableView')) return;
    populateTournaments(); populateEditions();
    $('tableTournament').onchange = () => { populateEditions(); page = 0; render(); };
    $('tableEdition').onchange = () => {
      const ed = $('tableEdition').value;
      if (ed && !allData[ed] && lazyMode && dataClient) {
        dataClient.ensureEdition(ed).then(() => {
          if ($('tableEdition').value === ed) {
            populateRounds(); populateRoundDims(); render();
          }
        }).catch(() => {});
      }
      populateRounds(); page = 0; render();
    };
    $('tableRound').onchange = () => { page = 0; populateRoundStrip(); render(); };
    if ($('tableRoundDim')) $('tableRoundDim').onchange = () => { page = 0; render(); };
    $('tableStatus').onchange = () => { page = 0; render(); };
    $('tableSort').onchange = () => { page = 0; render(); };
    let timer = 0;
    $('tablePlayer').oninput = () => { clearTimeout(timer); timer = setTimeout(() => { page = 0; render(); }, 180); };
    $('tableReset').onclick = () => {
      $('tableTournament').value = ''; populateEditions();
      $('tableEdition').value = ''; populateRounds();
      $('tableRound').value = ''; if ($('tableRoundDim')) $('tableRoundDim').value = ''; $('tablePlayer').value = '';
      $('tableStatus').value = ''; $('tableSort').value = 'date_desc';
      if ($('tableDateFrom')) $('tableDateFrom').value = '';
      if ($('tableDateTo')) $('tableDateTo').value = '';
      if ($('tableDateUnknown')) $('tableDateUnknown').checked = true;
      if ($('tableSgfOnly')) $('tableSgfOnly').checked = false;
      page = 0; render();
    };
    let dateTimer = 0;
    const dateChanged = () => { clearTimeout(dateTimer); dateTimer = setTimeout(() => { page = 0; render(); }, 180); };
    if ($('tableDateFrom')) $('tableDateFrom').oninput = dateChanged;
    if ($('tableDateTo')) $('tableDateTo').oninput = dateChanged;
    if ($('tableDateUnknown')) $('tableDateUnknown').onchange = () => { page = 0; render(); };
    if ($('tableSgfOnly')) $('tableSgfOnly').onchange = () => { page = 0; render(); };
    if ($('btnBatchEdit')) $('btnBatchEdit').onclick = () => {
      window.GoViewerBatchEditor?.open(getCurrentFilterScope());
    };
    $('tablePrev').onclick = () => { if (page > 0) { page -= 1; render(); } };
    $('tableNext').onclick = () => { page += 1; render(); };
    $('tableSearchRetry').onclick = render;
    $('btnViewTable').onclick = () => show();
    $('btnViewChart').onclick = () => hide();
    $('tableRounds').onclick = event => {
      const chip = event.target.closest('[data-table-round]');
      if (!chip) return;
      $('tableRound').value = chip.dataset.tableRound;
      page = 0; populateRoundStrip(); render();
    };
    $('tableFilterToggle').onclick = () => {
      const filters = document.querySelector('.table-filters');
      const open = filters.classList.toggle('filters-open');
      $('tableFilterToggle').setAttribute('aria-expanded', String(open));
      $('tableFilterToggle').textContent = open ? '收起筛选' : '筛选';
    };
    $('matchesTableBody').onclick = event => {
      const locate = event.target.closest('[data-locate-match]');
      if (locate) {
        hide();
        window.GoViewerNavigate?.focusMatch(locate.dataset.locateMatch, locate.dataset.locateEdition);
        return;
      }
      const sgfBtn = event.target.closest('[data-sgf-match]');
      if (sgfBtn) {
        const matchId = sgfBtn.dataset.sgfMatch;
        const editionId = sgfBtn.dataset.sgfEdition;
        const openSgfForMatch = () => {
          const data = allData[editionId];
          const round = data && (data.rounds || []).find(r => (r.matches || []).some(item => item.id === matchId));
          const found = round && round.matches.find(item => item.id === matchId);
          const row = rows.find(r => r.match.id === matchId);
          const targetMatch = found || (row && row.match);
          if (targetMatch && window.GoViewerNavigate?.showMatchDetails) {
            if (editionId && window.GoViewerNavigate.currentEdition?.() !== editionId && allData[editionId]) {
              window.GoViewerNavigate.loadEdition?.(editionId, {fromRoute: true, keepTable: true});
            }
            window.GoViewerNavigate.showMatchDetails(M.singleGamePresentation(targetMatch), {singleGame: true, tab: 'sgf'});
          }
        };
        if (editionId && !allData[editionId] && lazyMode && dataClient) {
          dataClient.ensureEdition(editionId).then(loaded => {
            if (loaded) allData[editionId] = loaded;
            openSgfForMatch();
          }).catch(() => openSgfForMatch());
        } else {
          openSgfForMatch();
        }
        return;
      }
      const player = event.target.closest('[data-table-player]');
      if (player) { window.showPlayer(player.dataset.tablePlayer); return; }
      const row = event.target.closest('tr[data-table-match]');
      if (row && window.GoViewerEditor?.enabled()) window.GoViewerEditor.open('matches', row.dataset.tableMatch);
    };
    $('matchesTableBody').onkeydown = event => {
      if (!['Enter', ' '].includes(event.key)) return;
      const row = event.target.closest('tr[data-table-match]');
      if (!row || event.target.closest('button,input,select,a')) return;
      event.preventDefault();
      if (window.GoViewerEditor?.enabled()) window.GoViewerEditor.open('matches', row.dataset.tableMatch);
    };
    window.addEventListener('go:edition-changed', event => {
      if (!active || window.__goViewerRefreshing || event.detail?.keepTable) return;
      const editionId = event.detail?.id;
      syncById();
      const meta = byId.get(editionId) || editionMetaFromData(editionId, allData[editionId]);
      if (!meta) return;
      if (meta.tournament_id) ensureTournamentOption(meta.tournament_id, meta.tournament_short || meta.tournament_name);
      $('tableTournament').value = meta.tournament_id || '';
      populateEditions();
      $('tableEdition').value = editionId;
      populateRounds();
      page = 0; render();
    });
    window.addEventListener('go:scope-changed', () => {
      if (!active) return;
      populateRounds();
      page = 0; render();
    });
  }
  function getCurrentFilterScope() {
    return {
      match_ids: useServerQuery() ? null : filtered().map(row => row.match.id),
      tournament_id: $('tableTournament')?.value || null,
      edition_id: $('tableEdition')?.value || null,
      round_id: $('tableRound')?.value || null,
      player_query: $('tablePlayer')?.value.trim() || '',
      status: $('tableStatus')?.value || null,
      date_from: $('tableDateFrom')?.value.trim() || null,
      date_to: $('tableDateTo')?.value.trim() || null,
      include_unknown_date: $('tableDateUnknown') ? $('tableDateUnknown').checked : true
    };
  }
  window.GoViewerTable = {show, hide, focusMatch, openQuery, refresh, routeFilters, rememberPosition, isActive: () => active, getCurrentFilterScope};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
