    (function() {
      // 1. Data Store
      const indexList = window.TOURNAMENTS_INDEX || [];
      const rankingList = window.CHAMPIONS_RANKING || [];
      const allData = window.ALL_TOURNAMENTS_DATA || {};
      const boot = window.GoStatsBoot || null;
      const dataClient = window.GoStatsDataClient || null;
      const publicMode = !!(dataClient && dataClient.isPublic);
      const lazyMode = !!(dataClient && (dataClient.isLazy || dataClient.isPublic));
      let editionRequestToken = 0;

      const M = window.GoViewerModel;
      const esc = M.escape;
      const playerList = M.collectPlayers(allData, window.PLAYERS_DATA || []);
      let playerAliases = {ids: window.PLAYER_ID_ALIASES || {}, names: window.PLAYER_NAME_ALIASES || {}};
      const editButton = (...args) => window.GoViewerEditor.button(...args);
      let currentEdges = [];
      const expandedSeries = new Set();
      let drawFrame = 0;
      const LEGACY_MODE_KEY = 'go_bracket_view_mode_v2';
      const PRESENTATION_KEY = 'go_bracket_presentation_v1';
      const ORIENTATION_KEY = 'go_bracket_orientation_v1';
      const THEME_KEY = 'go_viewer_theme_v1';
      let legacyMode = '';
      let storedPresentation = 'wiki';
      let storedOrientation = 'horizontal';
      let storedTheme = '';
      try {
        legacyMode = localStorage.getItem(LEGACY_MODE_KEY) || '';
        storedPresentation = localStorage.getItem(PRESENTATION_KEY) || (legacyMode === 'modern' ? 'modern' : 'wiki');
        storedOrientation = localStorage.getItem(ORIENTATION_KEY) || 'horizontal';
        storedTheme = localStorage.getItem(THEME_KEY) || '';
      } catch (_) {}
      const router = window.GoViewerRouter || null;
      const themeManager = window.GoViewerTheme || null;
      const initialRoute = router ? router.read() : null;
      const urlParams = new URLSearchParams(window.location.search);
      let currentEditionId = (initialRoute ? initialRoute.ed : urlParams.get("ed")) || "";
      let lastDrawerTrigger = null;
      let lastHofTrigger = null;
      let currentTournamentId = '';
      let currentTournamentEditions = [];
      let catalog = null;
      let zoomLevel = 1.0;
      let activeHighlightPlayer = null;
      const initialRouteMode = initialRoute ? initialRoute.mode : urlParams.get("mode");
      let lastStandardViewMode = ["modern", "wiki"].includes(initialRouteMode || storedPresentation) ? (initialRouteMode || storedPresentation) : "wiki";
      let currentViewMode = ["modern", "wiki", "draw"].includes(initialRouteMode || storedPresentation) ? (initialRouteMode || storedPresentation) : "wiki";
      const initialRouteOrient = initialRoute ? initialRoute.orient : urlParams.get("orient");
      let currentOrientation = ["horizontal", "vertical"].includes(initialRouteOrient || storedOrientation) ? (initialRouteOrient || storedOrientation) : "horizontal";
      // 赛段范围：正赛（默认） / 预选赛，按资料中的阶段和地区分组展示。
      let currentScope = initialRoute ? initialRoute.scope : (['prelim','unclassified'].includes(urlParams.get('scope')) ? urlParams.get('scope') : 'main');
      let prelimViewMode = 'tree';
      let activePrelimGroupKey = '';
      let routeView = initialRoute ? initialRoute.view : (urlParams.get('view') === 'table' ? 'table' : 'chart');
      // 外观主题与对阵呈现相互独立；旧“维基版/现代版”按原实际效果映射：维基=紧凑表格+浅色，现代=卡片+深色。
      const legacyThemeFallback = legacyMode === 'modern' || currentViewMode === 'modern' ? 'dark' : 'light';
      let themePreference = themeManager
        ? themeManager.getPreference({fallback: legacyThemeFallback})
        : (['light', 'dark', 'auto'].includes(urlParams.get('theme')) ? urlParams.get('theme')
          : (['light', 'dark', 'auto'].includes(storedTheme) ? storedTheme : legacyThemeFallback));
      let currentTheme = themeManager ? themeManager.resolve(themePreference) : '';
      let restoringRoute = false;
      let routeSequence = 0;
      let applyingDeepLink = false;
      let popStateBound = false;
      // 当前打开的对局详情（用于保存后原地更新，而不是关闭弹窗重建页面）。
      let openMatchContext = null;
      let dialogOpenedMatchUrl = false;

      // Pan & Zoom state
      let isPanning = false;
      let startX, startY, scrollLeft, scrollTop;
      const viewport = document.getElementById("viewport");
      const canvas = document.getElementById("canvas");
      const svg = document.getElementById("svgConnectors");

      // Use the same verified local flag on both view modes and all profile surfaces.
      function getFlagSvg(nat) { return window.GoViewerFlags.html(nat); }
      function stoneBox(m,p,tag='span') {
        const color=!(m.isSeries || m.series_score) && p.id && (m.black_player_id===p.id?'black':m.white_player_id===p.id?'white':'');
        return color ? `<${tag} class="player-stone${tag==='td'?' wiki-stone-cell':''}" title="执${color==='black'?'黑':'白'}" aria-label="执${color==='black'?'黑':'白'}"><i class="stone-icon stone-${color}"></i></${tag}>` : '';
      }
      function renderRoster() {
        const data=allData[currentEditionId],players=M.editionPlayers(data),query=document.getElementById('rosterSearch').value;
        document.getElementById('rosterTitle').textContent=`${data.tournament.short_name} ${M.editionLabel(data.edition)} · 参赛名单`;
        document.getElementById('rosterSummary').textContent=`已登记${players.length}人 · 本赛规模${data.edition.bracket_size || '待核'}人${players.length===data.edition.bracket_size?' · 名单齐全':' · 按现有对局汇总'}`;
        const shown=players.filter(p=>M.matchesPlayerQuery(p,query,playerAliases));
        document.getElementById('rosterPlayers').innerHTML=shown.map(p=>`<button type="button" class="roster-player" data-roster-player="${esc(p.id)}">${getFlagSvg(p.nationality)}<span>${esc(p.name_zh)}${p.name_native && p.name_native!==p.name_zh?`<small>${esc(p.name_native)}</small>`:''}</span></button>`).join('') || '<p>没有找到匹配的参赛棋手。</p>';
        document.querySelectorAll('[data-roster-player]').forEach(el=>el.onclick=()=>{document.getElementById('rosterDialog').close();window.showPlayer(el.dataset.rosterPlayer);});
      }

      function formatWikiDate(dateStr) {
        return esc(M.dateLabel(dateStr));
      }

      // 2. Initialize
      function hasLg29FinalLock(data) {
        const exclusions = data && Array.isArray(data.review_exclusions) ? data.review_exclusions : null;
        if (exclusions && exclusions.some(item => item && (item.id === 'lg_29_final_user_preserved' || item.edition_id === 'lg_29'))) {
          return true;
        }
        return ((data && data.edition && data.edition.id) || currentEditionId) === 'lg_29';
      }
      function refreshPlayerDirectory() {
        const directory = window.PLAYERS_DATA || [];
        playerList.splice(0, playerList.length, ...M.collectPlayers(allData, directory));
      }
      function ensureIndexItem(data) {
        const id = data && data.edition && data.edition.id;
        if (!id || indexList.some(item => item.id === id)) return;
        const item = boot && boot.indexItemFromEdition
          ? boot.indexItemFromEdition(data) : {id, tournament_id: data.tournament && data.tournament.id};
        if (boot && boot.mergeIndex) boot.mergeIndex([item]);
        else indexList.push(item);
      }
      async function ensureEditionData(edId) {
        if (allData[edId]) return true;
        if (!lazyMode || !dataClient) return false;
        const data = await dataClient.ensureEdition(edId);
        if (!data) return false;
        allData[edId] = data;
        ensureIndexItem(data);
        refreshPlayerDirectory();
        return true;
      }
      async function init() {
        if (!Array.isArray(window.TOURNAMENTS_INDEX)) {
          window.TOURNAMENTS_INDEX = indexList;
        }
        if (boot && boot.ready) {
          try {
            await boot.ready;
          } catch (error) {
            const notice = document.getElementById('viewerNotice');
            const summary = document.getElementById('dataSummary');
            if (notice) notice.textContent = publicMode ? '公开资料服务暂时不可用，请稍后重试。' : '读取本地资料失败，请确认查看器服务仍在运行后刷新。';
            if (summary) summary.textContent = '资料加载失败';
            return;
          }
        }
        playerAliases = {
          ids: window.PLAYER_ID_ALIASES || playerAliases.ids || {},
          names: window.PLAYER_NAME_ALIASES || playerAliases.names || {},
        };
        refreshPlayerDirectory();
        const requestedEdition = (initialRoute ? initialRoute.ed : urlParams.get('ed')) || '';
        const defaultId = (boot && boot.defaultEdition && boot.defaultEdition.id)
          || (boot && boot.featured && boot.featured.items && boot.featured.items[0] && boot.featured.items[0].latest_edition_id)
          || (indexList[0] && indexList[0].id)
          || '';
        let targetId = requestedEdition || currentEditionId || defaultId;
        if (lazyMode && dataClient && targetId) {
          try { await ensureEditionData(targetId); } catch (_) {
            if (requestedEdition && defaultId && defaultId !== requestedEdition) {
              targetId = defaultId;
              try { await ensureEditionData(targetId); } catch (__) {}
              deepLinkNotice('未找到指定届次，已切换至默认届次。');
            } else {
              deepLinkNotice('读取届次资料失败，请稍后重试。');
            }
          }
        }
        const bootStats = lazyMode && boot ? boot.stats : null;
        const isEmptyLibrary = bootStats
          ? Number(bootStats.editions || 0) === 0
          : (!targetId && indexList.length === 0);

        catalog = window.GoViewerCatalog.create({
          dataClient,
          boot,
          getCurrentEditionId: () => currentEditionId,
          getFlagSvg,
          onSelectEdition: async (edId, selOpts = {}) => {
            const ok = await loadEdition(edId, {push: true, clearMatch: true, fromCatalog: selOpts.fromCatalog});
            if (ok && selOpts.closeMobile) setMobileCatalog(false);
            return ok;
          },
          onTournamentEditions: (tid, items) => {
            currentTournamentId = tid || '';
            currentTournamentEditions = items || [];
            updateNavigation();
          },
        });

        if (isEmptyLibrary) {
          // 全新空库是合法状态：给出可执行的下一步，而不是误报“数据文件缺失”。
          document.getElementById('dataSummary').textContent = '暂无赛事资料';
          document.getElementById('sidebarCount').textContent = '0 项赛事';
          document.getElementById('bannerTitle').textContent = '暂无赛事资料';
          document.getElementById('viewerNotice').textContent = '当前数据工作区为空，请先导入数据。';
          document.getElementById('boardRoundSummary').textContent = '';
          await catalog.initView({mode: 'home'});
          setupEventListeners();
          for (const id of ['btnEditionRoster', 'btnExportBracket', 'btnPrevEd', 'btnNextEd']) {
            const control = document.getElementById(id);
            if (control) control.disabled = true;
          }
          return;
        }

        if (bootStats) {
          document.getElementById('dataSummary').textContent = `${bootStats.tournaments || 0} 项赛事 · ${bootStats.editions || 0} 届 · ${(bootStats.matches || 0).toLocaleString('zh-CN')} 局已录赛果`;
        } else {
          const matches = Object.values(allData).flatMap(d => d.rounds.flatMap(r => r.matches));
          document.getElementById('dataSummary').textContent = `${new Set(indexList.map(e => e.tournament_id)).size} 项赛事 · ${indexList.length} 届 · ${matches.filter(M.hasResult).length.toLocaleString('zh-CN')} 局已录赛果`;
        }
        currentEditionId = targetId;
        // Apply view mode & orientation
        syncViewModeButtons(allData[currentEditionId]);
        // 旧偏好迁移：首次加载时把旧“维基/现代”同时写入新的呈现与主题键。
        try {
          if (!localStorage.getItem(PRESENTATION_KEY)) localStorage.setItem(PRESENTATION_KEY, lastStandardViewMode);
          if (!localStorage.getItem(THEME_KEY)) localStorage.setItem(THEME_KEY, themePreference);
        } catch (_) {}

        const initialTournamentId = (allData[currentEditionId] && allData[currentEditionId].tournament && allData[currentEditionId].tournament.id)
          || (boot && boot.defaultEdition && boot.defaultEdition.tournament_id)
          || '';
        await catalog.initView({
          mode: requestedEdition ? 'tournament' : 'home',
          tournamentId: initialTournamentId,
          editionId: currentEditionId,
        });
        await loadEdition(currentEditionId, {push: false, skipCatalogSwitch: true, skipUrlSync: !requestedEdition});
        applyingDeepLink = true;
        try {
          if (routeView === 'table') {
            window.GoViewerTable?.show?.({fromRoute: true, route: initialRoute, search: location.search});
          }
          applyDeepLink();
        } finally {
          applyingDeepLink = false;
        }
        if (publicMode) {
          window.addEventListener('go-stats:leaderboards', () => {
            if (document.getElementById('hofModal')?.classList.contains('open')) renderHofGrid();
          });
        }
        setupEventListeners();
        setupPanZoom();
        setupSegmentedControls();
        bindRouterPopState();
      }

      // 深链接：index.html?ed=<届次>&match=<对局>，查看棋谱附加 tab=sgf。
      // 只有确认该记录属于当前届次才继续；先在签表中定位，无法定位时回退到原始
      // 单局详情，再不行退到对局表格。绝不默认打开整个系列的第一局。
      function deepLinkNotice(message) {
        const notice = document.getElementById('viewerNotice');
        if (notice) notice.textContent = message;
      }
      function applyDeepLink() {
        const playerId = urlParams.get('player');
        if (playerId) {
          window.showPlayer(playerId);
        }
        const matchId = urlParams.get('match');
        if (!matchId) return;
        const wantSgf = urlParams.get('tab') === 'sgf';
        const data = allData[currentEditionId];
        const round = data && (data.rounds || []).find(
          item => (item.matches || []).some(match => match.id === matchId));
        const match = round && round.matches.find(item => item.id === matchId);
        if (!match) {
          window.GoViewerTable?.focusMatch?.(matchId, undefined, {
            silentRoute: true,
            onSettled: () => deepLinkNotice('该对局不属于当前届次，已在对局表格中定位。'),
          });
          // 表格显示后重新写入提示，避免被届次说明覆盖。
          deepLinkNotice('该对局不属于当前届次，已在对局表格中定位。');
          return;
        }
        if (routeView === 'table') {
          showMatchDetails(M.singleGamePresentation(match), {singleGame: true, fromRoute: true, tab: wantSgf ? 'sgf' : ''});
          return;
        }
        const placed = focusMatchInBracket(matchId);
        if (!placed && !wantSgf) {
          showMatchDetails(M.singleGamePresentation(match), {singleGame: true});
          deepLinkNotice('该对局未在签表中展示，已打开单局详情。');
          return;
        }
        if (wantSgf) {
          showMatchDetails(M.singleGamePresentation(match), {singleGame: true});
          if (match.sgf?.present || match.has_sgf) window.GoViewerSgf?.selectTab?.('sgf');
          else deepLinkNotice('该对局暂无棋谱，已打开对局资料。');
        }
      }

      // Edition Navigation (always along the current tournament's editions)
      function orderedTournamentEditionsAsc() {
        return window.GoViewerCatalog.sortEditions(currentTournamentEditions || [], 'asc');
      }
      function updateNavigation() {
        const list = orderedTournamentEditionsAsc();
        const i = list.findIndex(e => e.id === currentEditionId);
        document.getElementById('btnPrevEd').disabled = i <= 0;
        document.getElementById('btnNextEd').disabled = i < 0 || i >= list.length - 1;
      }
      function syncUrl(options) {
        if (restoringRoute) return;
        const opts = options || {};
        const state = {
          ed: currentEditionId,
          mode: currentViewMode,
          orient: currentViewMode === 'draw' ? 'horizontal' : currentOrientation,
          scope: currentScope,
          view: routeView,
        };
        if (opts.match !== undefined) state.match = opts.match;
        if (opts.tab !== undefined) state.tab = opts.tab;
        if (opts.player !== undefined) state.player = opts.player;
        if (routeView === 'table' && window.GoViewerTable?.isActive()) state.table = window.GoViewerTable.routeFilters();
        else if (routeView !== 'table') state.table = null;
        if (router) {
          router.sync(state, {push: Boolean(opts.push && !window.__goViewerRefreshing)});
          return;
        }
        const url = new URL(window.location.href);
        url.searchParams.set('ed', currentEditionId);
        url.searchParams.set('mode', currentViewMode);
        if (currentScope !== 'main') url.searchParams.set('scope', currentScope);
        else url.searchParams.delete('scope');
        if (routeView === 'table') url.searchParams.set('view', 'table');
        else url.searchParams.delete('view');
        try { history[opts.push ? 'pushState' : 'replaceState'](null, '', url); } catch (_) {}
      }

      // Load a Specific Tournament Edition
      function loadEdition(edId, options) {
        const opts = options || {};
        const token = ++editionRequestToken;
        if (!allData[edId]) {
          if (!lazyMode || !dataClient) return Promise.resolve(false);
          deepLinkNotice('正在读取届次资料…');
          return dataClient.ensureEdition(edId).then(data => {
            if (token !== editionRequestToken) return false;   // 旧响应不得覆盖新选择
            if (!data) { deepLinkNotice('未找到该届次资料。'); return false; }
            allData[edId] = data;
            ensureIndexItem(data);
            refreshPlayerDirectory();
            const notice = document.getElementById('viewerNotice');
            if (notice) notice.textContent = '';
            renderEdition(edId, opts);
            return true;
          }).catch(error => {
            if (token !== editionRequestToken) return false;
            deepLinkNotice('读取届次资料失败：' + (error && error.message ? error.message : '未知错误'));
            return false;
          });
        }
        ensureIndexItem(allData[edId]);
        renderEdition(edId, opts);
        return Promise.resolve(true);
      }
      function renderEdition(edId, options) {
        const opts = options || {};
        if (!allData[edId]) return;
        if (edId !== currentEditionId) {
          activePrelimGroupKey = '';
          prelimViewMode = 'tree';
        }
        currentEditionId = edId;
        clearHighlight();
        // 预选赛视图只在含预选轮次的届次生效；其余届次自动回到正赛
        if (currentScope === 'prelim' && !M.prelimGroups(allData[edId]).length) currentScope = 'main';
        if (currentScope === 'unclassified' && !M.roundsForView(allData[edId]).unclassifiedRounds.length) currentScope = 'main';
        syncViewModeButtons(allData[edId]);

        const data = allData[edId];
        const meta = indexList.find(x => x.id === edId)
          || (boot && boot.indexItemFromEdition ? boot.indexItemFromEdition(data) : {id: edId, tournament_id: data.tournament?.id});

        if (!data) {
          console.error("No detail data for:", edId);
          return;
        }

        renderBanner(meta, data);
        renderCurrentBracket(data);
        frameCurrentView();
        if (!opts.skipCatalogSwitch) {
          catalog?.syncActiveEdition?.(meta, {
            openTournament: opts.openTournament === true,
            skipRecent: opts.skipRecent === true,
          });
        } else if (!opts.skipRecent) {
          catalog?.recordRecent?.(meta, data);
        }
        updateNavigation();
        if (!opts.fromRoute && !opts.skipUrlSync) syncUrl({
          push: Boolean(opts.push),
          match: opts.clearMatch ? null : undefined,
          tab: opts.clearMatch ? null : undefined,
        });
        requestDraw();
        window.dispatchEvent(new CustomEvent('go:edition-changed', {detail: {id: edId, keepTable: opts.keepTable || opts.fromRoute}}));
      }

      function syncViewModeButtons(data) {
        const meta = indexList.find(x => x.id === (data?.edition?.id || currentEditionId)) || {};
        const canDraw = Boolean(data && currentScope === 'main' && M.supportsStageDrawView(data));
        const btnDraw = document.getElementById('btnViewDraw');
        if (btnDraw) btnDraw.hidden = !canDraw;
        if (!canDraw && currentViewMode === 'draw') {
          currentViewMode = lastStandardViewMode;
        }
        const btnModern = document.getElementById("btnViewModern");
        const btnWiki = document.getElementById("btnViewWiki");
        if (btnModern && btnWiki) {
          btnModern.classList.toggle("active", currentViewMode === "modern");
          btnWiki.classList.toggle("active", currentViewMode === "wiki");
        }
        if (btnDraw) {
          btnDraw.classList.toggle("active", currentViewMode === "draw");
        }
        const mainEl = document.getElementById("mainView");
        if (mainEl) {
          mainEl.dataset.viewMode = currentViewMode;
          mainEl.dataset.bracketOrientation = currentOrientation;
        }
        document.body.dataset.viewMode = currentViewMode;
        document.body.dataset.bracketOrientation = currentOrientation;

        const orientGroup = document.getElementById('orientationToggleGroup');
        const btnHoriz = document.getElementById('btnOrientHorizontal');
        const btnVert = document.getElementById('btnOrientVertical');
        if (btnHoriz && btnVert) {
          btnHoriz.classList.toggle('active', currentOrientation === 'horizontal');
          btnVert.classList.toggle('active', currentOrientation === 'vertical');
          btnHoriz.setAttribute('aria-pressed', String(currentOrientation === 'horizontal'));
          btnVert.setAttribute('aria-pressed', String(currentOrientation === 'vertical'));
        }
        if (orientGroup) {
          const isTeam = Boolean(data && M.isTeamCompetition(data, meta));
          let isPureLeague = false;
          if (data && !isTeam && window.GoViewerLeague) {
            const view = M.roundsForView(data);
            const leagues = window.GoViewerLeague.partition(data, view.mainRounds);
            isPureLeague = leagues.groups.length > 0 && leagues.rest.length === 0;
          }
          const prelimTreeActive = Boolean(data && currentScope === 'prelim' && prelimViewMode === 'tree' && resolvePrelimTreeState(data).hasTrees);
          orientGroup.hidden = !data || (currentScope !== 'main' && !prelimTreeActive) || currentViewMode === 'draw' || isTeam || isPureLeague;
        }
      }

      function applyViewMode(mode, options) {
        const opts = options || {};
        const data = allData[currentEditionId];
        if (mode === 'draw' && (!data || currentScope !== 'main' || !M.supportsStageDrawView(data))) {
          mode = lastStandardViewMode;
        }
        currentViewMode = mode;
        if (mode === 'modern' || mode === 'wiki') {
          lastStandardViewMode = mode;
          if (opts.persist !== false) {
            try {
              localStorage.setItem(PRESENTATION_KEY, mode);
              localStorage.setItem(LEGACY_MODE_KEY, mode);
            } catch (_) {}
          }
        }
        activeHighlightPlayer = null;
        document.getElementById('btnHighlightClear').disabled = true;
        syncViewModeButtons(data);
        if (!opts.fromRoute && !opts.skipUrlSync) syncUrl({push: opts.push !== false});

        if (data) {
          renderCurrentBracket(data);
          frameCurrentView();
          requestDraw();
        }
      }

      function applyOrientation(orient, options) {
        const opts = options || {};
        currentOrientation = orient === 'vertical' ? 'vertical' : 'horizontal';
        if (opts.persist !== false) {
          try {
            localStorage.setItem(ORIENTATION_KEY, currentOrientation);
          } catch (_) {}
        }
        const data = allData[currentEditionId];
        syncViewModeButtons(data);
        if (!opts.fromRoute && !opts.skipUrlSync) syncUrl({push: opts.push !== false});
        if (data && currentViewMode !== 'draw') {
          renderCurrentBracket(data);
          frameCurrentView();
          requestDraw();
        }
      }
      function bindRouterPopState() {
        if (popStateBound) return;
        popStateBound = true;
        window.addEventListener('go:content-view-changed', event => {
          const nextView = event.detail?.view === 'table' ? 'table' : 'chart';
          const changed = nextView !== routeView;
          routeView = nextView;
          if (!restoringRoute && !applyingDeepLink && !event.detail?.fromRoute && !event.detail?.silentRoute && changed) {
            syncUrl({push: true});
          }
        });
        window.addEventListener('go:table-filters-changed', () => {
          if (routeView === 'table' && !applyingDeepLink) syncUrl();
        });
        document.getElementById('matchDialog').addEventListener('go:match-tab', event => {
          if (!applyingDeepLink && router?.read().match && event.target.open) syncUrl({tab: event.detail});
        });
        if (!router) return;
        router.onPopState(async route => {
          const sequence = ++routeSequence;
          ++editionRequestToken;
          const search = location.search;
          restoringRoute = true;
          try {
            const nextMode = route.mode && ['modern', 'wiki', 'draw'].includes(route.mode) ? route.mode : storedPresentation;
            const nextOrient = route.orient && ['horizontal', 'vertical'].includes(route.orient) ? route.orient : storedOrientation;
            currentOrientation = nextOrient;
            currentScope = route.scope || 'main';
            const targetEd = route.ed || currentEditionId;
            if (targetEd && targetEd !== currentEditionId) {
              currentViewMode = nextMode;
              await loadEdition(targetEd, {push: false, fromRoute: true});
            } else {
              if (nextMode !== currentViewMode) applyViewMode(nextMode, {persist: false, push: false, fromRoute: true});
              else if (allData[currentEditionId]) renderEdition(currentEditionId, {push: false, fromRoute: true});
            }
            if (sequence !== routeSequence || location.search !== search) return;
            const nextView = route.view === 'table' ? 'table' : 'chart';
            routeView = nextView;
            if (nextView === 'table') {
              window.GoViewerTable?.show?.({fromRoute: true, route, search});
            } else if (window.GoViewerTable?.isActive?.()) {
              window.GoViewerTable.hide({fromRoute: true});
            }
            const dialog = document.getElementById('matchDialog');
            if (route.match) {
              const data = allData[currentEditionId];
              const round = data && (data.rounds || []).find(r => (r.matches || []).some(m => m.id === route.match));
              const match = round && round.matches.find(m => m.id === route.match);
              if (match) showMatchDetails(M.singleGamePresentation(match), {singleGame: true, fromRoute: true, tab: route.tab});
              else if (dialog.open) { dialogOpenedMatchUrl = false; dialog.close(); }
            } else if (dialog && dialog.open) {
              dialogOpenedMatchUrl = false;
              dialog.close();
            }
            if (route.player) {
              window.showPlayer(route.player);
            } else {
              closePlayerDrawer({restoreFocus: false});
            }
          } finally {
            if (sequence === routeSequence) restoringRoute = false;
          }
        });
      }

      function frameCurrentView() {
        const data = allData[currentEditionId];
        const isStaticBoard = M.isTeamCompetition(data) || canvas.querySelector('.league-results');
        if (isStaticBoard) {
          zoomLevel = 1;
        } else if (currentViewMode === 'draw') {
          const fit = (viewport.clientWidth - 40) / Math.max(1, canvas.scrollWidth);
          zoomLevel = fit < 1 ? Math.max(0.65, fit) : 1;
        } else if (currentViewMode === 'modern' && currentOrientation === 'horizontal') {
          zoomLevel = Math.max(0.85, Math.min(1, (viewport.clientWidth - 40) / canvas.offsetWidth));
        } else {
          zoomLevel = 1;
        }
        canvas.style.zoom = String(zoomLevel);
        document.getElementById('btnResetZoom').textContent = Math.round(zoomLevel * 100) + '%';
        viewport.scrollLeft = currentViewMode === 'draw'
          ? Math.max(0, (canvas.scrollWidth * zoomLevel - viewport.clientWidth) / 2)
          : 0;
        viewport.scrollTop = currentViewMode === 'modern' && currentOrientation === 'horizontal' && !isStaticBoard
          ? Math.max(0, (canvas.scrollHeight * zoomLevel - viewport.clientHeight) / 2) : 0;
      }

      function resolvePrelimTreeState(data) {
        if (!data) return {groups: [], hasTrees: false, activeGroup: null, leagues: {groups: [], leagueRounds: []}, nonLeagueData: data};
        const leagues = window.GoViewerLeague
          ? window.GoViewerLeague.partition(data, (data.rounds || []).filter(M.isPrelimRound))
          : {groups: [], leagueRounds: []};
        const leagueIds = new Set(leagues.leagueRounds.map(r => r.id));
        const nonLeagueData = leagueIds.size ? {...data, rounds: (data.rounds || []).filter(r => !leagueIds.has(r.id))} : data;
        const treeState = M.prelimTreeGroups(nonLeagueData);
        const activeGroup = treeState.groups.find(g => g.key === activePrelimGroupKey && g.tree)
          || treeState.groups.find(g => g.tree)
          || null;
        if (activeGroup) activePrelimGroupKey = activeGroup.key;
        return {...treeState, activeGroup, leagues, nonLeagueData};
      }

      function scopeRounds(data) {
        if (currentScope === 'prelim') {
          return (data.rounds || []).filter(r => M.isPrelimRound(r));
        }
        if (currentScope === 'unclassified') return M.roundsForView(data).unclassifiedRounds;
        return (data.rounds || []).filter(r => !M.isPrelimRound(r) && !M.isUnclassifiedRound(r));
      }
      function scopeSummary(data) {
        const rounds = scopeRounds(data);
        const decided = rounds.flatMap(r => r.matches).filter(M.hasResult).length;
        if (currentScope === 'prelim') {
          const ps = resolvePrelimTreeState(data);
          if (ps.hasTrees && prelimViewMode === 'tree' && ps.activeGroup?.tree) {
            const grpDecided = ps.activeGroup.rounds.flatMap(r => r.matches || []).filter(M.hasResult).length;
            return `预选赛 ${ps.groups.length} 组 · ${ps.activeGroup.label || ps.activeGroup.region} · ${ps.activeGroup.rounds.length} 轮 · ${grpDecided} 局已录赛果`;
          }
          const groups = M.prelimGroups(data);
          return `预选赛 ${groups.length} 组 · ${rounds.length} 轮 · ${decided} 局已录赛果`;
        }
        if (currentScope === 'unclassified') return `赛段待核 · ${decided} 局已录赛果`;
        if (M.isTeamCompetition(data)) {
          const recorded = rounds.filter(r => r.matches.length);
          return `${recorded.length} 个已录赛段 · ${decided} 局已录赛果`;
        }
        const view=M.roundsForView(data);
        const leagues = window.GoViewerLeague?.partition?.(data, view.mainRounds);
        // 分组双败等小组赛不按“轮”称呼：组数与淘汰轮次分开报。
        if (leagues?.groups.length && leagues.groups.every(group => group.kind === 'group')) {
          return `${leagues.groups.length} 组 · ${leagues.rest.length + (view.thirdPlaceRound ? 1 : 0)} 轮 · ${decided} 局已录赛果`;
        }
        return `${view.mainRounds.length+(view.thirdPlaceRound ? 1 : 0)} 轮 · ${decided} 局已录赛果`;
      }
      function updateScopeButtons(data) {
        const group = document.getElementById('scopeToggleGroup');
        if (!group) return;
        const groups = M.prelimGroups(data);
        const hasPrelim = groups.length > 0;
        const unclassified = M.roundsForView(data).unclassifiedRounds;
        const btnUnknown = document.getElementById('btnScopeUnclassified');
        if (currentScope === 'unclassified' && !unclassified.length) currentScope = 'main';
        if (btnUnknown) {
          btnUnknown.hidden = !unclassified.length;
          btnUnknown.innerHTML = `赛段待核<small> ${unclassified.reduce((n,r)=>n+r.matches.length,0)}局</small>`;
          btnUnknown.classList.toggle('active', currentScope === 'unclassified');
        }
        if (currentScope === 'prelim' && !hasPrelim) currentScope = 'main';
        group.hidden = !hasPrelim && !unclassified.length;
        const games = groups.reduce((n, g) => n + g.games, 0);
        const btnPrelim = document.getElementById('btnScopePrelim');
        if (btnPrelim) btnPrelim.hidden = !hasPrelim;
        if (btnPrelim) btnPrelim.innerHTML = `预选赛${hasPrelim ? `<small> ${games}局</small>` : ''}`;
        document.getElementById('btnScopeMain')?.classList.toggle('active', currentScope === 'main');
        btnPrelim?.classList.toggle('active', currentScope === 'prelim');
      }

      // Render Banner Header
      function renderBanner(meta, data) {
        const titleEl = document.getElementById("bannerTitle");
        const chipsEl = document.getElementById("bannerChips");
        const podiumEl = document.getElementById("bannerPodium");
        document.getElementById('currentTournamentLabel').textContent = data.tournament.short_name;
        const editionCrumb = document.getElementById('currentEditionLabel');
        if (editionCrumb) editionCrumb.textContent = `${M.editionLabel(data.edition)}`;
        const tournamentLabel=document.getElementById('currentTournamentLabel');
        tournamentLabel.dataset.objectTable='tournaments';tournamentLabel.dataset.objectId=data.tournament.id;
        tournamentLabel.tabIndex=0;tournamentLabel.setAttribute('role','button');tournamentLabel.setAttribute('aria-label','编辑赛事资料');
        document.getElementById('competitionCategoryLabel').textContent = M.categoryLabel(data);
        document.getElementById('boardRoundSummary').textContent = scopeSummary(data);
        updateScopeButtons(data);
        document.getElementById('editionEditControls').innerHTML =
          '<span class="edit-hint">编辑模式：点击赛事名、届次标题、赛段标题或对局即可编辑；赛段排序等高级设置已折叠。</span><button class="btn btn-gold edit-only" id="btnBatchEditCurrentEdition" type="button" style="margin-left:0.75rem">批量编辑本届对局</button>';

        const rawMatches = scopeRounds(data).flatMap(r => r.matches);
        const hasLeagues = window.GoViewerLeague.partition(data, scopeRounds(data)).groups.length > 0;
        const prelimRoundIds = M.prelimRoundIds(data);
        const conflicts = currentScope === 'prelim' ? 0 : rawMatches.filter(m => M.dateConflict(m, data.edition, prelimRoundIds)).length;
        const unknownColors = rawMatches.filter(m => m.winner_id && !m.black_player_id && !m.white_player_id).length;
        const pendingGames = rawMatches.filter(m => M.matchStatus(m) === 'pending'
          && !['draw', 'bye'].includes(window.GoViewerLeague.outcome(m, M.participants(m)[0]).kind)).length;
        const scheduledGames = rawMatches.filter(m => M.matchStatus(m) === 'scheduled').length;
        const missingDates = rawMatches.filter(m => !String(m.date || '').trim()).length;
        const hasTeamTies = data.team_competition?.ties?.length > 0;
        const messages = [M.isTeamCompetition(data, meta) ? (hasTeamTies ? '本届为团体对抗赛，团体冠军不计入棋手个人冠军。' : '本届为团体赛。') : hasLeagues ? '' : data.edition.draw_policy==='fixed' ? '固定签位，不重新抽签。' : ''];
        document.querySelector('.board-legend').style.display=M.isTeamCompetition(data, meta) ? 'none' : '';
        if (scheduledGames) messages.push(`${scheduledGames} 局待赛。`);
        if (pendingGames) messages.push(`${pendingGames} 局赛果待补。`);
        if (conflicts) messages.push(`${conflicts} 条对局日期冲突，待核。`);
        if (data.tournament.id === 'tianfu') messages.push('小组决赛用于确定半决赛交叉对阵，负者仍可晋级。');
        if (hasLg29FinalLock(data)) messages.push('本届决赛按用户指定保留：柯洁胜、无胜负、无胜负；已锁定并排除后续纠错。');
        document.getElementById('viewerNotice').textContent = messages.filter(Boolean).join(' ');
        // Page and image exports share the same edition naming convention.
        titleEl.innerHTML = `
          <button type="button" class="banner-edit-title" data-object-table="editions" data-object-id="${esc(meta.id)}" aria-label="编辑本届资料">
            <span>${esc(M.editionTitle(data.edition, meta))}</span>
            <span class="edition-seq">总序 ${meta.seq}</span>
          </button>
        `;

        const periodChip = data.edition.start_date
          ? (data.edition.end_date ? `${data.edition.start_date} ～ ${data.edition.end_date}` : data.edition.start_date)
          : String(meta.year || '');
        const ruleChip = [data.edition.rules, data.edition.komi].filter(Boolean).map(v => esc(v)).join(' · ');
        const formatChip = M.editionFormatChip(data, meta);
        chipsEl.innerHTML = `
          <span class="chip">${M.categoryLabel(data)}</span>
          ${periodChip ? `<span class="chip">${esc(periodChip)}</span>` : ''}
          ${ruleChip ? `<span class="chip">${ruleChip}</span>` : ''}
          ${data.edition.time_limit ? `<span class="chip">${esc(data.edition.time_limit)}</span>` : ''}
          ${formatChip ? `<span class="chip">${esc(formatChip)}</span>` : ''}
          ${data.edition.notes ? `<span class="chip chip-note">${esc(data.edition.notes)}</span>` : ''}
          <button class="chip chip-action" id="editionReviewBtn" type="button">来源与核查</button>
        `;
        const editionReview = document.getElementById('editionReviewBtn');
        if (editionReview) editionReview.onclick = () => window.GoViewerReview?.open('editions', data.edition.id, '本届来源与核查');

        podiumEl.innerHTML = `
          <div class="podium-box">
            <div class="podium-icon">01</div>
            <div>
              <div class="podium-label">${M.isWorld(data) ? '世界冠军' : '本届冠军'}</div>
              <div class="podium-name${data.champion.id ? ' is-clickable' : ''}" onclick="${data.champion.id ? `window.showPlayer('${data.champion.id}')` : ''}">
                ${meta.champion ? getFlagSvg(meta.champion_nat) : ''}
                ${esc(meta.champion || (M.editionOngoing(meta) ? '待定' : '—'))}
              </div>
            </div>
          </div>
          <div class="podium-box">
            <div class="podium-icon">02</div>
            <div>
              <div class="podium-label">亚军${meta.finals_score ? ' (' + esc(meta.finals_score) + ')' : ''}</div>
              <div class="podium-name${data.runner_up.id ? ' is-clickable' : ''}" onclick="${data.runner_up.id ? `window.showPlayer('${data.runner_up.id}')` : ''}">
                ${meta.runner_up ? getFlagSvg(meta.runner_up_nat) : ''}
                ${esc(meta.runner_up || (M.editionOngoing(meta) ? '待定' : '—'))}
              </div>
            </div>
          </div>
        `;
      }

      // Dispatch Rendering Based on Current View Mode
      const observedLayoutSizes = new WeakMap();
      const bracketLayoutObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
        let changed = false;
        for (const entry of entries) {
          const el = entry.target;
          const prev = observedLayoutSizes.get(el);
          const next = { w: entry.contentRect.width, h: entry.contentRect.height };
          observedLayoutSizes.set(el, next);
          if (prev && (Math.abs(prev.w - next.w) > 0.25 || Math.abs(prev.h - next.h) > 0.25)) {
            changed = true;
          }
        }
        if (changed) requestDraw();
      }) : null;

      function observeBracketLayout() {
        if (!bracketLayoutObserver) return;
        bracketLayoutObserver.disconnect();
        canvas.querySelectorAll('.wiki-round-pill, .wiki-date-label, .wiki-finals-score, .round-header, .wiki-match-table, .wiki-r1-block-table, .match-card, .series-node, .draw-winner-box, .draw-final-unit')
          .forEach(el => bracketLayoutObserver.observe(el));
      }

      // 对局格子的棋手名必须完整显示：先按格宽逐级压缩该格字号（不低于 9px），
      // 仍放不下就让名字换行撑高格子，不用省略号截断。
      const NAME_FIT_MIN = 9;
      function fitPlayerNames(root = canvas) {
        root.querySelectorAll('.wiki-r1-player, .wiki-name-td, .player-name').forEach(cell => {
          if (cell.dataset.nameFitBase === undefined) {
            cell.dataset.nameFitBase = String(parseFloat(getComputedStyle(cell).fontSize) || 0);
          }
          const base = Number(cell.dataset.nameFitBase);
          if (!base) return;
          cell.style.fontSize = '';
          cell.style.whiteSpace = '';
          cell.style.overflowWrap = '';
          let size = base;
          while (size > NAME_FIT_MIN && cell.scrollWidth > cell.clientWidth) {
            size = Math.max(NAME_FIT_MIN, size - 0.5);
            cell.style.fontSize = size + 'px';
          }
          if (cell.scrollWidth > cell.clientWidth) {
            cell.style.whiteSpace = 'normal';
            cell.style.overflowWrap = 'anywhere';
          }
        });
      }
      function requestDraw() {
        cancelAnimationFrame(drawFrame);
        drawFrame = requestAnimationFrame(() => {
          fitPlayerNames();
          if (currentViewMode === 'wiki') centerWikiMatches();
          if (currentViewMode !== 'draw') alignSingleFeederStages();
          drawConnectors(); if (activeHighlightPlayer) highlightPlayer(activeHighlightPlayer);
        });
      }
      function renderCurrentBracket(data) {
        canvas.querySelectorAll('.league-results, .league-knockout, .draw-board').forEach(el => el.remove());
        delete canvas.dataset.league;
        delete canvas.dataset.binaryTree;
        delete canvas.dataset.doubleElimination;
        delete canvas.dataset.prelimTree;
        delete canvas.dataset.bracketOrientation;
        document.body.dataset.competitionView = M.isTeamCompetition(data, indexList.find(e => e.id === currentEditionId)) ? 'team' : 'bracket';
        if (currentScope === 'prelim' && M.prelimGroups(data).length) {
          const ps = resolvePrelimTreeState(data);
          if (ps.hasTrees && prelimViewMode === 'tree' && ps.activeGroup?.tree) {
            canvas.querySelectorAll('.prelim-view, .round-col').forEach(el => el.remove());
            canvas.dataset.prelimTree = 'true';
            canvas.dataset.bracketOrientation = currentOrientation;
            currentEdges = ps.activeGroup.tree.edges;
            svg.innerHTML = '';
            svg.removeAttribute('width'); svg.removeAttribute('height');
            svg.style.width = '0px'; svg.style.height = '0px';
            syncViewModeButtons(data);
            const prelimView = {mainRounds: ps.activeGroup.tree.rounds, thirdPlaceRound: null};
            if (currentViewMode === 'wiki') renderWikiBracket(ps.nonLeagueData, prelimView, false, {prelimTree: true});
            else renderModernBracket(ps.nonLeagueData, prelimView, false, {prelimTree: true});
            if (ps.leagues.groups.length) renderLeagues(data, ps.leagues.groups);
            renderRoundNav();
            window.GoNumbering?.decorate?.(canvas);
            observeBracketLayout();
            return;
          }
          currentEdges = [];
          svg.innerHTML = '';
          svg.removeAttribute('width'); svg.removeAttribute('height');
          svg.style.width = '0px'; svg.style.height = '0px';
          renderPrelimPanel(ps.nonLeagueData);
          if (ps.leagues.groups.length) renderLeagues(data, ps.leagues.groups);
          syncViewModeButtons(data);
          renderRoundNav();
          return;
        }
        if (currentScope === 'unclassified') {
          currentEdges = [];
          svg.innerHTML = '';
          svg.removeAttribute('width'); svg.removeAttribute('height');
          svg.style.width = '0px'; svg.style.height = '0px';
          renderPrelimPanel(data);
          syncViewModeButtons(data);
          renderRoundNav();
          return;
        }
        // 预选面板与正赛对阵图互斥：切回正赛/切换届次时必须清掉旧面板，
        // 否则它会作为画布的第一个 flex 子项留在左侧，把对阵列挤到右边。
        canvas.querySelectorAll('.prelim-view').forEach(el => el.remove());
        currentEdges = M.bracketEdgesForView(data, currentViewMode);
        svg.innerHTML = '';
        svg.removeAttribute('width'); svg.removeAttribute('height');
        svg.style.width = '0px'; svg.style.height = '0px';
        syncViewModeButtons(data);

        if (M.isTeamCompetition(data, indexList.find(e => e.id === currentEditionId))) {
          renderTeamResults(data);
        } else {
          const view = extractRoundsData(data), leagues = window.GoViewerLeague.partition(data, view.mainRounds);
          const knockoutView = {...view, mainRounds: leagues.rest};
          const leagueIds = new Set(leagues.leagueRounds.flatMap(r => r.matches.map(m => m.id)));
          if (leagues.groups.length) currentEdges = currentEdges.filter(e => !leagueIds.has(e.sourceId) && !leagueIds.has(e.targetId));
          if (currentViewMode === 'draw' && M.supportsStageDrawView(data)) {
            renderDrawBoardBracket(data, knockoutView);
          } else {
            canvas.dataset.bracketOrientation = currentOrientation;
            if (currentViewMode === 'wiki') renderWikiBracket(data, knockoutView, leagues.groups.length > 0);
            else renderModernBracket(data, knockoutView, leagues.groups.length > 0);
          }
          if (leagues.groups.length) {
            const columns = [...canvas.querySelectorAll('.round-col')];
            if (columns.length) {
              const knockout = document.createElement('section'); knockout.className = 'league-knockout';
              knockout.setAttribute('aria-label', '淘汰赛与名次赛');
              knockout.append(...columns); canvas.appendChild(knockout);
            }
            renderLeagues(data, leagues.groups);
          }
        }
        renderRoundNav();
        window.GoNumbering?.decorate?.(canvas);
        observeBracketLayout();
      }

      function renderRoundNav() {
        const nav = document.getElementById('bracketRoundNav');
        const data = allData[currentEditionId];
        if (currentScope === 'prelim' && data) {
          const ps = resolvePrelimTreeState(data);
          if (ps.hasTrees) {
            nav.replaceChildren();
            nav.hidden = false;
            const refreshPrelimView = () => {
              const sum = document.getElementById('boardRoundSummary');
              renderCurrentBracket(data);
              if (sum) sum.textContent = scopeSummary(data);
              frameCurrentView();
              if (canvas.dataset.prelimTree === 'true') requestDraw();
            };
            for (const [mode, label] of [['tree', '晋级树'], ['list', '列表']]) {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'round-chip prelim-mode-chip' + (prelimViewMode === mode ? ' active' : '');
              btn.dataset.prelimMode = mode;
              btn.setAttribute('aria-pressed', String(prelimViewMode === mode));
              btn.textContent = label;
              btn.onclick = () => {
                if (prelimViewMode === mode) return;
                prelimViewMode = mode;
                refreshPrelimView();
              };
              nav.append(btn);
            }
            const sep = document.createElement('span');
            sep.className = 'prelim-nav-sep';
            sep.setAttribute('aria-hidden', 'true');
            nav.append(sep);
            for (const group of ps.groups) {
              const btn = document.createElement('button');
              btn.type = 'button';
              const isSelected = prelimViewMode === 'tree' && group.key === ps.activeGroup?.key;
              btn.className = 'round-chip prelim-group-chip' + (isSelected ? ' active' : '');
              btn.dataset.prelimGroup = group.key;
              btn.setAttribute('aria-pressed', String(isSelected));
              const titleText = group.label || group.region;
              const subText = group.tree?.qualifier?.name_zh ? `${group.tree.qualifier.name_zh} 出线` : `${group.games}局`;
              btn.innerHTML = `${esc(titleText)}<small>${esc(subText)}</small>`;
              btn.onclick = () => {
                if (group.tree) {
                  activePrelimGroupKey = group.key;
                  prelimViewMode = 'tree';
                  refreshPrelimView();
                } else {
                  prelimViewMode = 'list';
                  refreshPrelimView();
                  const section = [...canvas.querySelectorAll('.prelim-region')]
                    .find(el => (el.dataset.group || el.dataset.region) === (group.label || group.region));
                  if (section) {
                    const origin = viewport.getBoundingClientRect(), target = section.getBoundingClientRect();
                    viewport.scrollTo({left: viewport.scrollLeft + target.left - origin.left - 12, top: viewport.scrollTop + target.top - origin.top - 12});
                  }
                }
              };
              nav.append(btn);
            }
            return;
          }
        }
        // 预选按组别分节时，跳转按钮按「组」组织：轮标题只写「第1轮」，按钮若只取轮标题
        // 会得到一串同名按钮；这里为每个组只出一个按钮，文字用组名。
        const seenGroups = new Set();
        const targets = [];
        for (const section of canvas.querySelectorAll('.round-col, .draw-stage-row, .prelim-round')) {
          const group = section.classList.contains('prelim-round')
            ? section.closest('.prelim-region[data-group]') : null;
          if (group) {
            if (seenGroups.has(group)) continue;
            seenGroups.add(group);
            const heading = group.querySelector('.prelim-region-head h3');
            if (heading) targets.push({section: group, label: heading});
            continue;
          }
          const label = section.querySelector('.wiki-round-pill, .round-title, .draw-plaque-round, .prelim-round-head h4');
          if (label) targets.push({section, label});
        }
        nav.replaceChildren();
        nav.hidden = targets.length < 2;
        if (nav.hidden) return;
        for (const {section, label} of targets) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'round-chip';
          button.textContent = (label.querySelector('.round-step')?.nextSibling?.textContent || label.textContent).trim();
          button.onclick = () => {
            const origin = viewport.getBoundingClientRect(), target = section.getBoundingClientRect();
            viewport.scrollTo({
              left: viewport.scrollLeft + target.left - origin.left - 12,
              top: viewport.scrollTop + target.top - origin.top - 12,
              behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
            });
          };
          nav.append(button);
        }
      }

      function renderLeagues(data, groups) {
        canvas.dataset.league = 'true';
        document.body.dataset.competitionView = 'league';
        window.GoViewerLeague.render({data, groups, canvas, scope: currentScope, onDraw: requestDraw,
          showPlayer: id => window.showPlayer(id),
          showMatch: game => showMatchDetails(M.singleGamePresentation(game), {singleGame: true})});
      }

      function renderTeamResults(data) {
        currentEdges = [];
        window.GoViewerTeam.render({data, canvas, mode: currentViewMode, flag: getFlagSvg,
          wikiGame: createWikiMatchTable, modernGame: createMatchCard, onDraw: requestDraw,
          showPlayer: id => window.showPlayer(id),
          showMatch: game => showMatchDetails(M.singleGamePresentation(game), {singleGame: true})});
      }

      // ----------------------------------------------------
      // Scope B: Preliminary rounds (CWI import), grouped by region.
      // 不与正赛对阵图混排：预选赛用独立的分组列表面板。
      // ----------------------------------------------------
      function prelimMatchRow(m) {
        const parts = M.participants(m);
        const winId = m.winner?.id || m.winner_id || '';
        // 胜方在前、负方在后，顺序与正赛对局行一致：棋手 | 执色 | 胜法。
        const winIndex = winId ? parts.findIndex(p => p.id === winId) : -1;
        const winner = winIndex >= 0 ? parts[winIndex] : (m.winner?.id ? m.winner : (parts[0] || {}));
        let loser = winIndex >= 0 ? parts[winIndex === 0 ? 1 : 0] : null;
        if (!loser) loser = parts.find(p => p !== winner && (p.id || p.name_zh)) || {};
        const winnerColor = winId
          ? (m.black_player_id === winId ? 'black' : m.white_player_id === winId ? 'white' : '')
          : (m.black_player_id ? 'black' : '');
        const loserColor = winnerColor === 'black' ? (m.white_player_id ? 'white' : '')
          : winnerColor === 'white' ? (m.black_player_id ? 'black' : '') : '';
        const method = winId ? (M.winnerLabel(m) || '胜') : M.matchResult(m);
        const date = m.date ? esc(M.dateLabel(m.date)) : '<span class="is-empty">日期未载</span>';
        const playerCell = (p, won) => {
          if (!p.id && !p.name_zh) return '<span class="prelim-player is-empty">对手未载</span>';
          const label = `${p.id ? getFlagSvg(p.nationality) : ''}<span class="prelim-player-name" title="${esc(p.name_zh || p.id)}">${esc(p.name_zh || p.id)}</span>`;
          return p.id
            ? `<button type="button" class="prelim-player${won ? ' is-winner' : ''}" data-player-id="${esc(p.id)}">${label}</button>`
            : `<span class="prelim-player${won ? ' is-winner' : ''}">${label}</span>`;
        };
        const colorCell = color => color
          ? `<span class="prelim-color" title="执${color === 'black' ? '黑' : '白'}" aria-label="执${color === 'black' ? '黑' : '白'}"><i class="stone-icon stone-${color}" aria-hidden="true"></i></span>`
          : '<span class="prelim-color is-empty" title="执色未载" aria-label="执色未载"><span aria-hidden="true">—</span></span>';
        const noColor = !winnerColor && !loserColor;
        return `<div class="prelim-match${noColor ? ' prelim-match-nocolor' : ''}" data-match-id="${esc(m.id)}" data-winner-id="${esc(winId)}" role="button" tabindex="0" title="打开对局详情">
          <span class="prelim-match-date">${date}</span>
          ${playerCell(winner, true)}
          ${colorCell(winnerColor)}
          <span class="prelim-method" title="${esc(method)}">${esc(method)}</span>
          ${playerCell(loser, false)}
          ${colorCell(loserColor)}
        </div>`;
      }
      function prelimRoundBlock(round, section) {
        // 综合预选组的轮名去掉“（统合）”括注，组标题已表达地区口径
        let label = String(round.round_name || '').replace('（统合）', '');
        // 按组别分节时，节标题已给出组别，轮标题只留「第N轮／决赛」这样的后段
        if (section && section.label) {
          const index = label.indexOf(section.label);
          if (index >= 0) {
            const tail = label.slice(index + section.label.length).replace(/^[｜|]\s*/, '').trim();
            if (tail) label = tail;
          }
        }
        return `<section class="prelim-round">
          <header class="prelim-round-head">
            <h4 data-object-table="rounds" data-object-id="${esc(round.id)}" role="button" tabindex="0" title="编辑赛段资料">${esc(label)}</h4>
            <span class="prelim-round-meta">${esc(round.date_range || '日期未载')} · ${round.matches.length}局</span>
          </header>
          <div class="prelim-matches">${round.matches.map(m => prelimMatchRow(m)).join('')}</div>
        </section>`;
      }
      function renderPrelimPanel(data) {
        canvas.querySelectorAll('.round-col, .prelim-view, .team-results').forEach(el => el.remove());
        const unknown = currentScope === 'unclassified';
        const rs = M.roundsForView(data).unclassifiedRounds;
        const groups = unknown ? [{region:'赛段待核',rounds:rs,games:rs.reduce((n,r)=>n+r.matches.length,0)}] : M.prelimGroups(data);
        if (!groups.length) return;
        const wrap = document.createElement('div');
        wrap.className = 'prelim-view';
        const totalGames = groups.reduce((n, g) => n + g.games, 0);
        wrap.innerHTML = `<div class="prelim-intro">${unknown ? '未明确本赛或预选归属，或暂未接入晋级图；点击对局可查看详情与棋谱。' : '按阶段、地区与组别分组；点击对局可查看详情与棋谱。'}共 ${groups.length} 组 · ${totalGames} 局。</div>` +
          groups.map(g => `
          <section class="prelim-region" data-region="${esc(g.region)}"${g.label ? ` data-group="${esc(g.label)}"` : ''}>
            <header class="prelim-region-head"><h3>${esc(g.label || g.region)}</h3><span>${g.label ? `${esc(g.region)} · ` : ''}${g.rounds.length} 轮 · ${g.games} 局</span></header>
            ${g.rounds.map(round => prelimRoundBlock(round, g)).join('')}
          </section>`).join('');
        canvas.appendChild(wrap);
        wrap.querySelectorAll('[data-player-id]').forEach(el => {
          el.onclick = event => { event.stopPropagation(); if (el.dataset.playerId) window.showPlayer(el.dataset.playerId); };
        });
        wrap.querySelectorAll('.prelim-match').forEach(el => {
          const open = () => {
            const match = (data.rounds || []).flatMap(r => r.matches).find(x => x.id === el.dataset.matchId);
            if (match) showMatchDetails(match);
          };
          el.onclick = open;
          el.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } };
        });
      }

      // Separate Knockout Tree Rounds from 3rd-Place Playoff
      function extractRoundsData(data) { return M.roundsForView(data); }

      // Aggregate Multi-game Semifinal Matches into Series Format (2 Matches: Winner vs Loser, X-Y)
      function aggregateSemifinalMatches(round, finalId) { return M.aggregateSeries(round, finalId); }
      // An incomplete edition may currently stop at the quarter-finals; never
      // label the last recorded round as the final unless its name says so.
      function isFinalRoundName(round) {
        return M.isFinalRound(round);
      }
      function isSemifinalRoundName(round) {
        return /半决赛|準決賽/.test(round.round_name || '');
      }

      const seriesKey = m => `${currentEditionId}:${m.id}`;
      function seriesMarks(m) {
        const outcomes = M.seriesOutcomes(m);
        const mark = symbol => symbol === '○' || symbol === '×'
          ? `<svg class="series-mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">${symbol === '○'
            ? '<circle cx="12" cy="12" r="8" />'
            : '<path d="M4 4L20 20M20 4L4 20" />'}</svg>` : esc(symbol);
        return `<span class="series-outcomes" aria-label="逐局赛果，以第一行棋手为准">${outcomes.length
          ? outcomes.map(o => `<span class="series-outcome" data-symbol="${esc(o.symbol)}" title="${esc(o.label)}" aria-label="${esc(o.label)}">${mark(o.symbol)}</span>`).join('')
          : '<span class="series-unrecorded">逐局未载</span>'}</span>`;
      }
      function seriesControls(host, m, wiki = false) {
        const actions = host.querySelector('.series-actions');
        const open = expandedSeries.has(seriesKey(m));
        if (m.subgames?.length) {
          const toggle = document.createElement('button');
          toggle.type = 'button'; toggle.className = 'series-toggle';
          toggle.textContent = open ? '收起' : '展开';
          toggle.setAttribute('aria-expanded', String(open));
          toggle.setAttribute('aria-label', `${open ? '收起' : '展开'}逐局比赛`);
          toggle.onclick = event => {
            event.stopPropagation();
            if (open) expandedSeries.delete(seriesKey(m)); else expandedSeries.add(seriesKey(m));
            renderCurrentBracket(allData[currentEditionId]); requestDraw();
            [...canvas.querySelectorAll('.series-toggle')].find(b => b.closest('[data-series-id]')?.dataset.seriesId === m.id)?.focus({preventScroll: true});
          };
          actions.append(toggle);
        }
        const details = document.createElement('button');
        details.type = 'button'; details.className = 'series-details match-details-btn'; details.textContent = '详情';
        details.onclick = event => {event.stopPropagation(); showMatchDetails(m);};
        actions.append(details);
        if (!wiki && open && m.subgames?.length) {
          const panel = document.createElement('div'); panel.className = 'series-games';
          panel.setAttribute('aria-label', '逐局比赛');
          m.subgames.forEach((g, i) => {
            const card = createMatchCard(g, !!m.isFinalSeries, false, true, m.isFinalSeries ? i : null);
            card.id = 'series-game-' + g.id;
            panel.append(card);
          });
          host.append(panel);
        }
      }
      function createSeriesNode(m, wiki, top = 0, horizontal = false) {
        const node = document.createElement('div');
        node.className = 'series-node'; node.dataset.seriesId = m.id;
        node.style.top = top + 'px';
        if (wiki && expandedSeries.has(seriesKey(m)) && m.subgames?.length) {
          node.classList.add('wiki-series-expanded');
          if (horizontal) node.classList.add('wiki-series-expanded-wide');
          // The series keeps its advancement anchor while its summary is replaced.
          node.id = 'wiki-match-' + m.id;
          const panel = document.createElement('div');
          panel.className = 'series-games wiki-series-games' + (horizontal ? ' wiki-series-horizontal' : '');
          panel.setAttribute('aria-label', '逐局比赛');
          m.subgames.forEach((game, i) => {
            const block = document.createElement('div'); block.className = 'wiki-series-game';
            block.innerHTML = `<div class="wiki-game-heading"><span>${esc(M.seriesGameLabel(game, i))}</span><span>${esc(M.dateLabel(game.date))}</span></div>`;
            const table = createWikiMatchTable(game, 0, {singleGame: true, gameNumber: i});
            table.id = 'wiki-series-game-' + game.id;
            block.append(table); panel.append(block);
          });
          const actions = document.createElement('div'); actions.className = 'series-actions wiki-series-actions';
          node.append(panel, actions);
        } else {
          const summary = wiki ? createWikiMatchTable(m, 0) : createMatchCard(m, false, false);
          node.append(summary);
        }
        seriesControls(node, m, wiki);
        return node;
      }

      function stageNodesForRounds(mainRounds, data, opts = {}) {
        if (opts?.prelimTree) return mainRounds.map(round => round.matches);
        const finalRound = mainRounds.find(isFinalRoundName);
        const finalId = finalRound?.matches[0]?.id;
        return mainRounds.map((round, rIndex) => {
          if (isFinalRoundName(round)) {
            const summary = M.finalSeries(round, data);
            if (summary) return [summary];
          }
          if ((rIndex === mainRounds.length - 2 || isSemifinalRoundName(round)) && rIndex < mainRounds.length - 1) {
            return aggregateSemifinalMatches(round, finalId);
          }
          return round.matches;
        });
      }

      function resolveKnockoutPlan(roundsView, data, opts = {}) {
        const isPrelimTree = Boolean(opts?.prelimTree);
        const hasDoubleElimination = isPrelimTree ? null : M.doubleEliminationLanes(roundsView.mainRounds, currentEdges);
        const stageNodes = stageNodesForRounds(roundsView.mainRounds, data, opts);
        // 只有届次资料能对上「首轮局数 + 2×第二轮局数」的参赛人数时，第二轮才可能
        // 整场轮空（20 人本赛 = 4 + 2×8）。缺局的完整签表人数对不上，不把空来源当轮空；
        // 没有登记规模的旧届次只在明确记录过轮空时放宽。
        const bracketSize = Number(data.edition?.bracket_size);
        const impliedPlayers = (stageNodes[0]?.length || 0) + 2 * (stageNodes[1]?.length || 0);
        const allowByeTargets = isPrelimTree ? true
          : (Number.isInteger(bracketSize) && bracketSize > 0
            ? bracketSize === impliedPlayers
            : Number(data.edition?.bye_count) > 0);
        const plan = hasDoubleElimination ? null
          : window.GoViewerLayout.orderKnockoutStages(stageNodes, currentEdges, {allowByeTargets});
        const roundsMatches = plan ? plan.stages : stageNodes;
        const mainRounds = plan ? roundsView.mainRounds.map((round, i) => (
          !isPrelimTree && isFinalRoundName(round) && M.finalSeries(round, data)
            ? round
            : {...round, matches: plan.stages[i]}
        )) : roundsView.mainRounds;
        const doubleLanes = isPrelimTree ? null : M.doubleEliminationLanes(mainRounds, currentEdges);
        const doubleBlocks = doubleLanes ? M.doubleEliminationBlocks(mainRounds, currentEdges) : null;
        return {plan, roundsMatches, mainRounds, doubleLanes, doubleBlocks};
      }

      // 淘汰树里的单线接力（挑战者决定战→决赛、决赛对在位者）只有一名晋级者。
      // 逐局卡片比单局卡片高，量得的高度差会让接力点上下错位、连线出现折角；
      // 布局完成后按实际锚点把后续节点对齐到前驱轴线上。
      // 只在整段都是单线接力时对齐：轮空或晋级来源未载的对局也只有一个前驱，
      // 但它在多场的赛段里已有自己的位置，硬挪会压到相邻对局框。
      function alignSingleFeederStages() {
        if (!currentEdges.length || canvas.dataset.doubleElimination === 'true') return;
        const vertical = currentOrientation === 'vertical';
        const prefix = currentViewMode === 'wiki' ? 'wiki-match-' : 'match-';
        const canvasRect = canvas.getBoundingClientRect();
        const actualZoom = canvasRect.width / canvas.offsetWidth || zoomLevel || 1;
        const stageCount = new WeakMap();
        const siblingsOf = el => {
          const stage = el.closest('.modern-stage, .wiki-matches-stage');
          if (!stage) return 1;
          if (!stageCount.has(stage)) {
            stageCount.set(stage, [...stage.children].filter(child =>
              !child.classList.contains('third-place-container')
              && !child.classList.contains('wiki-third-place-box')).length);
          }
          return stageCount.get(stage);
        };
        const byTarget = new Map();
        for (const edge of currentEdges) {
          if (edge.kind === 'loser') continue;
          if (!byTarget.has(edge.targetId)) byTarget.set(edge.targetId, []);
          byTarget.get(edge.targetId).push(edge);
        }
        for (const [targetId, edges] of byTarget) {
          if (edges.length !== 1) continue;
          const target = document.getElementById(prefix + targetId);
          const source = document.getElementById(prefix + edges[0].sourceId);
          if (!target || !source) continue;
          if (siblingsOf(target) > 1) continue;
          const a = connectorAnchor(source), b = connectorAnchor(target);
          const delta = vertical
            ? (a.left + a.width / 2) - (b.left + b.width / 2)
            : (a.top + a.height / 2) - (b.top + b.height / 2);
          if (Math.abs(delta) < 1) continue;
          // 紧凑表格式把表格包在定位用的系列节点里，位移要落在真正定位的容器上。
          const host = target.closest('.series-node') || target;
          const key = vertical ? 'left' : 'top';
          host.style[key] = (parseFloat(host.style[key]) || 0) + delta / actualZoom + 'px';
          // 对齐可能把节点推到赛段之外；只放大该赛段的既有尺寸，保证不被裁切。
          const stage = host.parentElement;
          if (!stage || !stage.matches('.modern-stage, .wiki-matches-stage')) continue;
          const sizeStyle = vertical ? 'width' : 'height';
          const limit = parseFloat(stage.style[sizeStyle]);
          const needed = (vertical ? host.offsetLeft + host.offsetWidth : host.offsetTop + host.offsetHeight);
          if (Number.isFinite(limit) && needed > limit + 0.5) stage.style[sizeStyle] = Math.ceil(needed) + 'px';
        }
      }

      // ----------------------------------------------------
      // View Mode A: Graphite workspace with aligned advancement stages.
      // ----------------------------------------------------
      function renderModernBracket(data, roundsView = extractRoundsData(data), leagueMode = false, opts = {}) {
        const isPrelimTree = Boolean(opts?.prelimTree);
        canvas.querySelectorAll('.round-col').forEach(col => col.remove());
        const vertical = currentOrientation === 'vertical';
        const {plan, roundsMatches, mainRounds, doubleLanes, doubleBlocks} = resolveKnockoutPlan(roundsView, data, opts);
        canvas.dataset.binaryTree = String(Boolean(plan));
        canvas.dataset.doubleElimination = String(Boolean(doubleLanes));
        const {thirdPlaceRound} = roundsView;
        const stages = [], containers = [];
        let third = null;
        mainRounds.forEach((round, index) => {
          const final = !isPrelimTree && isFinalRoundName(round);
          const games = roundsMatches[index];
          const column = document.createElement('div');
          column.className = 'round-col'; column.dataset.roundOrder = round.round_order;
          column.innerHTML = `<div class="round-header">
            <div class="round-title" ${round.source_rounds ? '' : `data-object-table="rounds" data-object-id="${esc(round.id)}" role="button" tabindex="0"`} title="${round.source_rounds ? '按赛制合并显示的原始赛段' : '编辑赛段资料'}"><span class="round-step">${String(index + 1).padStart(2,'0')}</span>${esc(M.roundDisplayName(round))}</div>
            <div class="round-date">${esc(round.date_range || '日期未载')} · ${round.matches.length}局</div>
            </div><div class="modern-stage round-matches"></div>`;
          column.querySelector('.round-title').title = round.source_round_name || round.round_name;
          canvas.appendChild(column);
          const stage = column.querySelector('.modern-stage'); containers.push(stage);
          const nodes = [];
          const summary = final ? M.finalSeries(round, data) : null;
          if (final && summary) {
            // 纯循环圈赛事把决赛单独放在表格下方，逐局卡片横向展开；
            // 若决赛是本赛淘汰树的终点，则保持竖向，随连线排在最后一列。
            const horizontal = leagueMode && mainRounds.length === 1;
            if (horizontal) column.classList.add('finals-wide');
            const finalGames = summary.subgames || round.matches;
            const group = document.createElement('div');
            group.className = 'finals-container' + (horizontal ? ' finals-horizontal' : '');
            group.id = 'match-' + finalGames[0].id;
            const scoreLine = `<div class="series-overview"><span>本届总比分</span><strong>${esc(data.edition.finals_score || '待定')}</strong></div>`;
            const finalTitle = M.isSingleGameFinal(data) ? '决赛' : `决赛 · ${esc(data.edition.finals_type || '番棋')}`;
            group.innerHTML = horizontal
              ? `<div class="finals-head"><div class="finals-badge-title">${finalTitle}</div>${scoreLine}</div><div class="finals-games"></div>`
              : `<div class="finals-badge-title">${finalTitle}</div>${scoreLine}`;
            const list = horizontal ? group.querySelector('.finals-games') : group;
            finalGames.forEach((game, i) => {
              const card = createMatchCard(game, true, false, true, finalGames.length > 1 ? i : null);
              if (!i) card.id = 'match-game-' + game.id;
              list.appendChild(card);
            });
            const details = document.createElement('button'); details.type = 'button'; details.className = 'series-details';
            details.textContent = '详情';
            details.onclick = () => showMatchDetails({...finalGames[0], subgames: finalGames, isFinalSeries: true});
            (horizontal ? group.querySelector('.finals-head') : group).appendChild(details);
            stage.appendChild(group);
            nodes.push({id:finalGames[0].id, height:group.offsetHeight, width:group.offsetWidth, element:group});
            if (thirdPlaceRound?.matches.length) {
              const box = document.createElement('div'); box.className = 'third-place-container';
              box.innerHTML = '<div class="third-place-badge-title">三四名决赛</div>';
              thirdPlaceRound.matches.forEach(game => box.appendChild(createMatchCard(game, false, true)));
              stage.appendChild(box); third = {element:box, height:box.offsetHeight, width:box.offsetWidth};
            }
          } else {
            games.forEach(game => {
              const card = game.isSeries || game.series_score ? createSeriesNode(game, false) : createMatchCard(game, false, false); stage.appendChild(card);
              nodes.push({id:game.id, height:card.offsetHeight, width:card.offsetWidth, element:card});
            });
          }
          stages.push(nodes);
        });
        const preserveOrder = data.edition?.draw_policy === 'redraw' && !plan;
        if (vertical) {
          const layout = doubleLanes ? window.GoViewerLayout.arrangeDoubleElimination(stages, doubleLanes, currentEdges, 22, 'horizontal', doubleBlocks)
            : plan?.byeCompact ? window.GoViewerLayout.arrangeByeHeadCompact(stages, plan.r0Slots, 22, 'horizontal')
            : plan?.hasByeFirstRound ? window.GoViewerLayout.arrangeBinaryWithByes(stages, plan.r0Slots, 22, 'horizontal')
            : window.GoViewerLayout.arrangeAxis(stages, currentEdges, 22, preserveOrder, 'horizontal');
          layout.stages.forEach((nodes, idx) => {
            let rowHeight = 0;
            nodes.forEach(node => {
              node.element.style.left = node.left + 'px';
              node.element.style.top = '0px';
              rowHeight = Math.max(rowHeight, node.element.offsetHeight);
            });
            if (third && idx === layout.stages.length - 1) {
              rowHeight = Math.max(rowHeight, third.element.offsetHeight);
            }
            containers[idx].style.height = Math.max(112, rowHeight) + 'px';
          });
          let width = layout.width;
          if (third) {
            const finalsRight = Math.max(0, ...layout.stages.at(-1).map(p => p.left + p.width));
            third.element.style.left = finalsRight + 30 + 'px';
            third.element.style.top = '0px';
            width = Math.max(width, finalsRight + 30 + third.width);
          }
          containers.forEach(stage => stage.style.width = Math.max(220, width + (doubleLanes ? 50 : 0)) + 'px');
        } else {
          const layout = doubleLanes ? window.GoViewerLayout.arrangeDoubleElimination(stages, doubleLanes, currentEdges, 30, 'vertical', doubleBlocks)
            : plan?.byeCompact ? window.GoViewerLayout.arrangeByeHeadCompact(stages, plan.r0Slots, 30, 'vertical')
            : plan?.hasByeFirstRound ? window.GoViewerLayout.arrangeBinaryWithByes(stages, plan.r0Slots, 30, 'vertical')
            : window.GoViewerLayout.arrange(stages, currentEdges, 30, preserveOrder);
          layout.stages.forEach(nodes => nodes.forEach(node => node.element.style.top = node.top + 'px'));
          let height = layout.height;
          if (third) {
            const finalsBottom = Math.max(0,...layout.stages.at(-1).map(p => p.top + p.height));
            third.element.style.top = finalsBottom + 30 + 'px';
            height = Math.max(height, finalsBottom + 30 + third.height);
          }
          containers.forEach(stage => stage.style.height = (height + (doubleLanes ? 50 : 0)) + 'px');
        }
        alignSingleFeederStages();
      }

      function createMatchCard(m, isFinalSubgame, isThirdPlace, singleGame = isFinalSubgame, gameNumber = null) {
        if (singleGame) m = M.singleGamePresentation(m);
        const card = document.createElement('div');
        card.className = 'match-card' + (isThirdPlace ? ' match-card-third-place' : '');
        card.id = 'match-' + m.id; card.dataset.matchId = m.id;
        card.dataset.objectTable = 'matches'; card.dataset.objectId = m.id;
        card.dataset.nextId = isThirdPlace ? '' : (m.next_match_id || '');
        const players = M.participants(m), winner = m.winner || {};
        const isSeries = Boolean(m.isSeries || m.series_score);
        // 半决赛、决赛只记录系列比分时（无逐局赛果），结果标签直接给出比分。
        const seriesOnly = Boolean(m.series_score) && (!m.result_detail || m.result_detail === '胜' || m.result_detail === `${m.series_score} 胜出`);
        const result = winner.id ? (isSeries && m.series_score ? `${m.series_score} 胜出` : M.winnerLabel(m)) : M.matchResult(m);
        const fullDate = M.dateLabel(m.date);
        const dateText = fullDate.replace(new RegExp('\\b' + allData[currentEditionId].edition.year + '-', 'g'), '');
        card.title = [m.tooltip, !isSeries && !m.black_player_id && !m.white_player_id ? '执色未载，按资料顺序显示' : '', result].filter(Boolean).join('\n');
        const row = (p, slot) => {
          const won = M.samePlayer(winner, p);
          let score = '';
          if (isSeries) {
            const numeric = /^(\d+)-(\d+)$/.exec(m.series_score || '');
            const wScore = m.winner_score ?? (numeric ? numeric[1] : '');
            const lScore = m.loser_score ?? (numeric ? numeric[2] : '');
            if (m.player_scores) score = m.player_scores[slot];
            else if (won) score = wScore;
            else if (winner.id) score = lScore;
          } else if (won) {
            score = M.winnerLabel(m);
          }
          return `<div class="player-row ${won ? 'winner' : ''}" data-player-name="${esc(p.name_zh || '轮空 / 待定')}" data-player-id="${esc(p.id || '')}" role="button" tabindex="0">
            <div class="player-info">
              ${p.id ? getFlagSvg(p.nationality) : ''}<span class="player-name">${esc(p.name_zh || '轮空 / 待定')}</span></div>
            <span class="player-outcome">${esc(score ?? '')}</span>${stoneBox(m,p)}</div>`;
        };
        // 决赛逐局卡片按顺序显示“第N局”；导入用的 SRC- 来源编号只用于溯源，不当标题。
        const matchCode = isThirdPlace ? '季军战'
          : gameNumber === null ? (m.draw_group || m.bracket_code || '对局' + (m.match_number || ''))
          : M.seriesGameLabel(m, gameNumber);
        card.innerHTML = `<div class="match-top-bar"><span class="match-code">${esc(matchCode)}</span>
          <span class="match-date" title="${esc(fullDate)}">${esc(dateText)}${M.dateConflictInEdition(m, allData[currentEditionId]) ? ' · 待核' : ''}</span></div>
          ${players.map(row).join('')}
          ${isSeries ? `<div class="match-bottom-bar series-footer">${seriesMarks(m)}<span class="series-actions"></span></div>` :
          `<div class="match-bottom-bar"><button class="result-badge match-details-btn" type="button">${esc(result)} · 详情</button>
          ${window.GoViewerEditor.quick(m)}<span class="match-link-label">${isThirdPlace ? '季军战' : isFinalSubgame ? '决赛单局' : '单局'}</span></div>`}`;
        card.querySelectorAll('.player-row').forEach(el => {
          const name = el.dataset.playerName, id = el.dataset.playerId;
          el.onmouseenter = () => id && highlightPlayer(name);
          el.onclick = event => {event.stopPropagation(); if (id) window.showPlayer(id);};
          el.onkeydown = event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); el.click();}};
        });
        const details = card.querySelector('.match-details-btn');
        if (details) details.onclick = event => {event.stopPropagation(); showMatchDetails(m, {singleGame: !!singleGame, gameNumber});};
        return card;
      }

      // ----------------------------------------------------
      // View Mode B: Wikipedia Compact (Classic Paper Style)
      // ----------------------------------------------------
      function renderWikiBracket(data, roundsView = extractRoundsData(data), leagueMode = false, opts = {}) {
        const isPrelimTree = Boolean(opts?.prelimTree);
        const columns = canvas.querySelectorAll(".round-col");
        columns.forEach(col => col.remove());

        const vertical = currentOrientation === 'vertical';
        const meta = indexList.find(x => x.id === currentEditionId) || {};
        const {plan, roundsMatches, mainRounds, doubleLanes, doubleBlocks} = resolveKnockoutPlan(roundsView, data, opts);
        const byeCompact = Boolean(plan?.byeCompact);
        canvas.dataset.binaryTree = String(Boolean(plan));
        canvas.dataset.doubleElimination = String(Boolean(doubleLanes));
        const {thirdPlaceRound} = roundsView;
        if (mainRounds.length === 0) return;

        // Detect 32-player bracket (16 matches in R1, 8 in R2)
        const is32PlayerCompact = !isPrelimTree && !vertical && !plan && !doubleLanes && mainRounds[0]?.matches.length === 16 && mainRounds[1]?.matches.length === 8 &&
          mainRounds[0].matches.every((m, i) => currentEdges.some(e => e.sourceId === m.id && e.kind === 'winner' && e.targetId === mainRounds[1].matches[Math.floor(i / 2)].id));

        // Detect 24-player or 48-player bracket where Round 1 has byes feeding Round 2
        // 24-player: R1 has 8 matches, R2 has 8 matches (8 players bye)
        // 48-player: R1 has 16 matches, R2 has 16 matches (16 players bye)
        const is24Or48Compact = !isPrelimTree && !vertical && !is32PlayerCompact && !doubleLanes && (function() {
          if (mainRounds.length < 2) return false;
          const isGroupStage = (mainRounds[0]?.matches || []).some(m => /^GRP-/.test(m.bracket_code || ''));
          if (isGroupStage) return false;
          const r0Len = mainRounds[0]?.matches.length || 0;
          const r1Len = mainRounds[1]?.matches.length || 0;
          const r2Len = mainRounds[2]?.matches.length || 0;
          const size = data.edition?.bracket_size;
          if (size === 24 || (size !== 32 && r0Len === 8 && r1Len === 8 && (r2Len === 4 || mainRounds.length === 2))) return true;
          if (size === 48 || (size !== 32 && r0Len === 16 && r1Len === 16 && (r2Len === 8 || mainRounds.length === 2))) return true;
          return false;
        })();

        const matchSize = vertical ? 188 : 58;
        const gap = vertical ? 20 : 36;
        const pitch = matchSize + gap;
        const startOffset = 8;

        // Determine base match count
        let baseMatchCount = 8;
        if (is32PlayerCompact) {
          baseMatchCount = 8;
        } else if (is24Or48Compact) {
          baseMatchCount = roundsMatches[1]?.length || 8;
        } else if (plan?.hasByeFirstRound) {
          baseMatchCount = byeCompact ? (roundsMatches[1]?.length || 4) : (roundsMatches[1]?.length || 4) * 2;
        } else if (roundsMatches.length > 0) {
          const r0Len = roundsMatches[0].length;
          const r1Len = roundsMatches[1]?.length || 0;
          if (r0Len === 2 * r1Len) {
            baseMatchCount = r0Len;
          } else if (r0Len <= r1Len) {
            baseMatchCount = r1Len;
          } else if (r0Len > 20) {
            baseMatchCount = Math.max(8, r1Len);
          } else {
            baseMatchCount = Math.max(r0Len, r1Len);
          }
        }

        let totalStageExtent = Math.max(vertical ? 420 : 640, startOffset * 2 + Math.max(baseMatchCount, ...roundsMatches.slice(0, -1).map(r => r.length)) * pitch);

        // Ensure stage extent is big enough if 3rd place match exists next to finals
        if (thirdPlaceRound && thirdPlaceRound.matches && thirdPlaceRound.matches.length > 0) {
          const estFinalsPos = totalStageExtent / 2 - matchSize / 2;
          const estThirdEnd = estFinalsPos + matchSize + 40 + (vertical ? matchSize : 80);
          if (estThirdEnd > totalStageExtent) {
            totalStageExtent = estThirdEnd + 24;
          }
        }

        const roundPositions = [];
        // Round 0 feeds Round 1 when every game has a confirmed next match; a 24-player
        // bracket can send two first-round winners into one second-round game, so the
        // games are ordered by their target instead of being forced 1-to-1.
        const firstTargets = roundsMatches[0].map(m => currentEdges.find(e => e.sourceId === m.id && e.kind === 'winner')?.targetId);
        const is1to1Feeder = roundsMatches.length >= 2 && roundsMatches[0].length <= roundsMatches[1].length &&
          firstTargets.every(Boolean);

        roundsMatches.forEach((matches, rIndex) => {
          const isFinalRound = !isPrelimTree && isFinalRoundName(mainRounds[rIndex]);
          const positions = [];

          if (is32PlayerCompact && rIndex === 0) {
            for (let k = 0; k < 8; k++) {
              const offset = startOffset + k * pitch;
              positions.push({ offset, center: offset + matchSize / 2 });
            }
          } else if (is32PlayerCompact && rIndex === 1) {
            for (let i = 0; i < 8; i++) {
              const offset = startOffset + i * pitch;
              positions.push({ offset, center: offset + matchSize / 2 });
            }
          } else if (is24Or48Compact && rIndex === 0) {
            const r1Count = roundsMatches[1]?.length || 8;
            for (let k = 0; k < r1Count; k++) {
              const offset = startOffset + k * pitch;
              positions.push({ offset, center: offset + matchSize / 2 });
            }
          } else if (is24Or48Compact && rIndex === 1) {
            for (let i = 0; i < matches.length; i++) {
              const offset = startOffset + i * pitch;
              positions.push({ offset, center: offset + matchSize / 2 });
            }
          } else if (plan?.hasByeFirstRound && rIndex === 0) {
            matches.forEach(m => {
              const slot = plan.r0Slots.get(m.id) ?? 0;
              const offset = startOffset + slot * pitch;
              positions.push({ offset, center: offset + matchSize / 2 });
            });
          } else if (plan?.hasByeFirstRound && rIndex === 1) {
            for (let j = 0; j < matches.length; j++) {
              // 紧凑轮空只有一轮来源：第二轮逐局占一个槽位；双来源轮空每场占两个槽位。
              const c = startOffset + (byeCompact ? j : 2 * j + 0.5) * pitch + matchSize / 2;
              positions.push({ offset: c - matchSize / 2, center: c });
            }
          } else if (is1to1Feeder && rIndex === 0) {
            // Keep each first-round game aligned with its target, in target order.
            const nextMatches = roundsMatches[1] || [];
            const rank = id => {
              const found = nextMatches.findIndex(nm => nm.id === id);
              return found === -1 ? nextMatches.length : found;
            };
            const order = matches.map((m, mIdx) => ({ mIdx, t: rank(m.next_match_id) }))
              .sort((a, b) => a.t - b.t || a.mIdx - b.mIdx);
            order.forEach((item, k) => {
              const offset = startOffset + k * pitch;
              positions[item.mIdx] = { offset, center: offset + matchSize / 2 };
            });
          } else if (is1to1Feeder && rIndex === 1) {
            // Round 1 is the base of the knockout tree
            for (let i = 0; i < matches.length; i++) {
              const offset = startOffset + i * pitch;
              positions.push({ offset, center: offset + matchSize / 2 });
            }
          } else if (rIndex === 0) {
            for (let i = 0; i < matches.length; i++) {
              const offset = startOffset + i * pitch;
              positions.push({ offset, center: offset + matchSize / 2 });
            }
          } else {
            const prevPositions = roundPositions[rIndex - 1] || [];
            if (isFinalRound && matches.length === 1) {
              const prevLen = prevPositions.length;
              let c = totalStageExtent / 2;
              if (prevLen >= 2) {
                c = (prevPositions[0].center + prevPositions[prevLen - 1].center) / 2;
              } else if (prevLen === 1) {
                c = prevPositions[0].center;
              }
              positions.push({ offset: c - matchSize / 2, center: c });
            } else if (prevPositions.length === 2 * matches.length) {
              // Standard binary fork reduction: center between parent pairs
              for (let j = 0; j < matches.length; j++) {
                const c = (prevPositions[j * 2].center + prevPositions[j * 2 + 1].center) / 2;
                positions.push({ offset: c - matchSize / 2, center: c });
              }
            } else if (plan && prevPositions.length === matches.length) {
              // 已确认的二叉树里的单线接力：整段沿用前驱轴线，不再平均分布。
              for (let j = 0; j < matches.length; j++) {
                const c = prevPositions[j].center;
                positions.push({ offset: c - matchSize / 2, center: c });
              }
            } else {
              // Fallback evenly distributed across extent
              const step = totalStageExtent / matches.length;
              for (let j = 0; j < matches.length; j++) {
                const c = j * step + step / 2;
                positions.push({ offset: c - matchSize / 2, center: c });
              }
            }
          }
          roundPositions.push(positions);
        });

        if (doubleLanes) {
          const axis = vertical ? 'horizontal' : 'vertical';
          const layout = window.GoViewerLayout.arrangeDoubleElimination(
            roundsMatches.map(matches => matches.map(m => ({id: m.id, width: matchSize, height: matchSize}))),
            doubleLanes, currentEdges, gap, axis, doubleBlocks);
          layout.stages.forEach((nodes, i) => {
            const byId = new Map(nodes.map(n => [n.id, n]));
            roundPositions[i] = roundsMatches[i].map(m => {
              const node = byId.get(m.id);
              return {offset: vertical ? node.left : node.top, center: node.center};
            });
          });
          totalStageExtent = Math.max(totalStageExtent, (vertical ? layout.width : layout.height) + startOffset * 2 + 50);
        }

        mainRounds.forEach((round, rIndex) => {
          const isFinalRound = !isPrelimTree && isFinalRoundName(round);
          const isR1Compact = (is32PlayerCompact && rIndex === 0) || (is24Or48Compact && rIndex === 0);

          const matches = roundsMatches[rIndex];

          const col = document.createElement("div");
          col.className = `round-col ${isR1Compact ? 'wiki-col-r1-compact' : ''}`;
          col.dataset.roundOrder = round.round_order;
          const finalSummary = isFinalRound ? M.finalSeries(round, data) : null;
          const horizontalFinal = Boolean(leagueMode && mainRounds.length === 1 && finalSummary && expandedSeries.has(seriesKey(finalSummary)));
          if (horizontalFinal) col.classList.add('finals-wide');

          const cleanTitle = M.roundDisplayName(round) || `第${rIndex + 1}轮`;

          const dateText = formatWikiDate(round.date_range || (round.matches[0] && round.matches[0].date) || '', cleanTitle);
          const venueText = (rIndex === 0 && data.edition && data.edition.notes && data.edition.notes.includes("举办")) ? '' : '';

          const stageStyle = vertical ? `width: ${totalStageExtent}px;` : `height: ${totalStageExtent}px;`;
          col.innerHTML = `
            <div class="wiki-round-head">
              <div class="wiki-round-pill" ${round.source_rounds ? '' : `data-object-table="rounds" data-object-id="${esc(round.id)}" role="button" tabindex="0"`} title="${round.source_rounds ? '按赛制合并显示的原始赛段' : esc(round.source_round_name || '编辑赛段资料')}">${esc(cleanTitle)}</div>
              <div class="wiki-date-label">${dateText}${venueText}</div>
              ${horizontalFinal && finalSummary.series_score ? `<div class="wiki-finals-score">本届总比分 <strong>${esc(finalSummary.series_score)}</strong></div>` : ''}
            </div>
            <div class="wiki-matches-stage" style="${stageStyle}"></div>
          `;

          const stage = col.querySelector(".wiki-matches-stage");
          const positions = roundPositions[rIndex] || [];
          const placeNode = (el, offset) => {
            if (vertical) {
              el.style.top = '0px';
              el.style.left = `${offset}px`;
              el.dataset.wikiCenter = String(offset + matchSize / 2);
            } else {
              el.style.top = `${offset}px`;
            }
            return el;
          };

          if (is32PlayerCompact && rIndex === 0) {
            for (let k = 0; k < 8; k++) {
              const mA = round.matches[2 * k];
              const mB = round.matches[2 * k + 1];
              const pos = positions[k] || { offset: startOffset + k * pitch };
              stage.appendChild(createWikiR1BlockTable(mA, mB, pos.offset, k));
            }
          } else if (is24Or48Compact && rIndex === 0) {
            const nextRoundMatches = roundsMatches[1] || [];
            const r0Matches = round.matches || [];
            const usedR0Ids = new Set();

            const blocksData = nextRoundMatches.map((targetMatch, blockIndex) => {
              const [p1, p2] = M.participants(targetMatch);
              const slots = [
                { p: p1, slotIndex: 0 },
                { p: p2, slotIndex: 1 }
              ];
              // First pass: match by winner
              slots.forEach(slot => {
                if (!slot.p || (!slot.p.id && !slot.p.name_zh)) return;
                let m = r0Matches.find(cand => !usedR0Ids.has(cand.id) &&
                  cand.next_match_id === targetMatch.id && M.samePlayer(cand.winner, slot.p));
                if (!m) {
                  m = r0Matches.find(cand => !usedR0Ids.has(cand.id) && M.samePlayer(cand.winner, slot.p));
                }
                if (m) {
                  slot.match = m;
                  usedR0Ids.add(m.id);
                }
              });
              // Second pass: for unassigned slots, check pointing match if slot is undecided
              slots.forEach(slot => {
                if (slot.match) return;
                if (slot.p && (slot.p.id || slot.p.name_zh)) return;
                const preferredSlots = slot.slotIndex === 0 ? ['black', 'participant_1'] : ['white', 'participant_2'];
                let m = r0Matches.find(cand => !usedR0Ids.has(cand.id) &&
                  cand.next_match_id === targetMatch.id && preferredSlots.includes(cand.next_slot));
                if (!m) {
                  m = r0Matches.find(cand => !usedR0Ids.has(cand.id) && cand.next_match_id === targetMatch.id);
                }
                if (m) {
                  slot.match = m;
                  usedR0Ids.add(m.id);
                }
              });
              return { targetMatch, slots, blockIndex };
            });

            blocksData.forEach(({ targetMatch, slots, blockIndex }) => {
              const pos = positions[blockIndex] || { offset: startOffset + blockIndex * pitch };
              stage.appendChild(createWiki24Or48BlockTable(targetMatch, slots, pos.offset, blockIndex));
            });
          } else if (isFinalRound && M.finalSeries(round, data)) {
            const pos = positions[0] || { offset: totalStageExtent / 2 - matchSize / 2 };
            stage.appendChild(placeNode(createWikiFinalsTable(round, meta, data, vertical ? 0 : pos.offset, horizontalFinal), pos.offset));

            // Standalone 3rd place box placed beside/underneath the finals without connecting lines
            if (thirdPlaceRound && thirdPlaceRound.matches && thirdPlaceRound.matches.length > 0) {
              const thirdMatch = thirdPlaceRound.matches[0];
              const thirdOffset = pos.offset + matchSize + 40;
              const box = createWikiThirdPlaceBox(thirdMatch, vertical ? 0 : thirdOffset);
              if (vertical) {
                box.style.top = '0px';
                box.style.left = `${thirdOffset}px`;
                box.style.right = 'auto';
              }
              stage.appendChild(box);
            }
          } else {
            matches.forEach((m, mIdx) => {
              const pos = positions[mIdx] || { offset: startOffset + mIdx * pitch };
              const el = m.isSeries || m.series_score ? createSeriesNode(m, true, vertical ? 0 : pos.offset) : createWikiMatchTable(m, vertical ? 0 : pos.offset);
              stage.appendChild(placeNode(el, pos.offset));
            });
          }

          canvas.appendChild(col);
        });
        canvas.querySelectorAll('.wiki-matches-stage').forEach(stage => {
          if (vertical) stage.dataset.baseWidth = totalStageExtent;
          else stage.dataset.baseHeight = totalStageExtent;
        });
        window.GoNumbering?.decorate?.(canvas);
        centerWikiMatches();
        alignSingleFeederStages();
      }

      function centerWikiMatches() {
        const stages = [...canvas.querySelectorAll('.wiki-matches-stage')];
        if (!stages.length) return;
        const vertical = currentOrientation === 'vertical';
        const actualZoom = canvas.getBoundingClientRect().width / canvas.offsetWidth || zoomLevel;
        if (vertical) {
          const nodes = stages.map(stage => [...stage.children].filter(node => !node.classList.contains('wiki-third-place-box')).map(element => {
            if (!element.dataset.wikiCenter) element.dataset.wikiCenter = (parseFloat(element.style.left) || 0) + 94;
            const rect = element.getBoundingClientRect(), anchor = connectorAnchor(element);
            return {element, baseCenter: Number(element.dataset.wikiCenter), width: element.offsetWidth,
              anchorOffset: (anchor.left + anchor.width / 2 - rect.left) / actualZoom};
          }));
          const layout = window.GoViewerLayout.centerWikiStagesHorizontal(nodes, 20, 8);
          let width = Math.max(layout.width, ...stages.map(stage => Number(stage.dataset.baseWidth) || 0));
          layout.stages.forEach((placements, i) => {
            placements.forEach(p => { p.element.style.left = p.left + 'px'; p.element.style.top = '0px'; });
            const third = stages[i].querySelector(':scope > .wiki-third-place-box');
            if (third) {
              const right = Math.max(0, ...placements.map(p => p.left + p.width));
              third.style.left = right + 36 + 'px';
              third.style.top = '0px';
              third.style.right = 'auto';
              width = Math.max(width, right + 36 + third.offsetWidth + 24);
            }
          });
          stages.forEach(stage => {
            stage.style.width = width + 'px';
            const tallest = Math.max(76, ...[...stage.children].map(el => el.offsetHeight + 16));
            stage.style.height = tallest + 'px';
          });
          return;
        }
        const nodes = stages.map(stage => [...stage.children].filter(node => !node.classList.contains('wiki-third-place-box')).map(element => {
          if (!element.dataset.wikiCenter) element.dataset.wikiCenter = (parseFloat(element.style.top) || 0) + 29;
          const rect = element.getBoundingClientRect(), anchor = connectorAnchor(element);
          return {element, baseCenter: Number(element.dataset.wikiCenter), height: element.offsetHeight,
            anchorOffset: (anchor.top + anchor.height / 2 - rect.top) / actualZoom};
        }));
        const layout = window.GoViewerLayout.centerWikiStages(nodes);
        let height = Math.max(layout.height, ...stages.map(stage => Number(stage.dataset.baseHeight) || 0));
        layout.stages.forEach((placements, i) => {
          placements.forEach(p => p.element.style.top = p.top + 'px');
          const third = stages[i].querySelector(':scope > .wiki-third-place-box');
          if (third) {
            const bottom = Math.max(0, ...placements.map(p => p.top + p.height));
            third.style.top = bottom + 40 + 'px';
            height = Math.max(height, bottom + 40 + third.offsetHeight + 24);
          }
        });
        stages.forEach(stage => {
          const wideFinal = stage.closest('.round-col.finals-wide');
          const node = wideFinal ? stage.querySelector(':scope > .series-node') : null;
          stage.style.height = (node ? Math.max(96, node.offsetHeight + 24) : height) + 'px';
        });
      }

      function createWiki24Or48BlockTable(targetMatch, slots, top, blockIndex) {
        const table = document.createElement("table");
        table.className = "wiki-match-table wiki-r1-block-table wiki-bye-table";
        table.id = `wiki-r1-bye-block-${blockIndex}`;
        table.dataset.blockIndex = blockIndex;
        table.dataset.targetId = targetMatch?.id || "";
        table.style.top = `${top}px`;

        const blockMatches = slots.map(s => s.match).filter(Boolean);

        function renderSlotRow(slot) {
          const m = slot.match;
          if (m) {
            const winner = m.winner || {};
            const [cand1, cand2] = M.participants(m);
            const advancing = winner.id ? winner : (slot.p?.id ? slot.p : cand1);
            const opponent = M.samePlayer(advancing, cand1) ? cand2 : cand1;

            const advName = advancing.name_zh || "待定";
            const advNat = advancing.nationality || "UNK";

            const oppName = opponent.name_zh || "待定";
            const oppNat = opponent.nationality || "UNK";

            const isDecided = !!winner.id;
            const resultRaw = isDecided ? (M.winnerLabel(m) || '胜') : M.matchResult(m);
            const resultText = String(resultRaw).replace(/0\.25子/g, '1/4子').replace(/0\.75子/g, '3/4子');

            const advStoneTd = stoneBox(m, advancing, 'td') || '<td class="player-stone wiki-stone-cell wiki-col-s1"></td>';
            const oppStoneTd = stoneBox(m, opponent, 'td') || '<td class="player-stone wiki-stone-cell wiki-col-s2"></td>';

            return `
              <tr class="wiki-r1-row wiki-bye-match-row" data-match-id="${m.id}" id="wiki-match-${m.id}" data-next-id="${targetMatch.id}" data-object-table="matches" data-object-id="${m.id}">
                <td class="wiki-r1-player wiki-col-p1 ${isDecided ? 'winner' : ''}" data-player-name="${esc(advName)}" data-player-id="${esc(advancing.id || '')}">
                  ${getFlagSvg(advNat)}<span class="wiki-pname">${esc(advName)}</span>
                </td>
                ${advStoneTd}
                <td class="wiki-r1-score wiki-col-res ${isDecided ? 'winner-score' : ''}" title="${esc(resultRaw)}">${esc(resultText)}</td>
                <td class="wiki-r1-player wiki-col-p2 wiki-r1-opponent" data-player-name="${esc(oppName)}" data-player-id="${esc(opponent.id || '')}">
                  ${getFlagSvg(oppNat)}<span class="wiki-pname">${esc(oppName)}</span>
                </td>
                ${oppStoneTd}
              </tr>
            `;
          } else {
            const p = slot.p || {};
            const pName = p.name_zh || "轮空/待定";
            const pNat = p.nationality || "UNK";
            const byeSourceId = `bye-${targetMatch.id}-${slot.slotIndex}`;

            if (p.name_zh && !currentEdges.some(e => e.sourceId === byeSourceId && e.targetId === targetMatch.id)) {
              currentEdges.push({
                sourceId: byeSourceId,
                targetId: targetMatch.id,
                player: p.name_zh,
                kind: 'bye'
              });
            }

            return `
              <tr class="wiki-r1-row wiki-bye-empty-row" data-bye-id="${byeSourceId}" id="wiki-match-${byeSourceId}" data-next-id="${targetMatch.id}" data-player-name="${esc(pName)}">
                <td colspan="2" class="wiki-r1-player wiki-col-p1 wiki-bye-player" data-player-name="${esc(pName)}" data-player-id="${esc(p.id || '')}">
                  ${p.id ? getFlagSvg(pNat) : ''}<span class="wiki-pname">${esc(pName)}</span>
                </td>
                <td class="wiki-r1-score wiki-col-res wiki-bye-empty-score"></td>
                <td colspan="2" class="wiki-r1-player wiki-col-p2 wiki-bye-cell text-muted">
                  <span class="wiki-bye-text">轮空</span>
                </td>
              </tr>
            `;
          }
        }

        table.innerHTML = '<colgroup><col style="width:147px"><col style="width:25px"><col style="width:76px"><col style="width:147px"><col style="width:25px"></colgroup>' + renderSlotRow(slots[0]) + renderSlotRow(slots[1]);

        if (blockMatches.length > 0) {
          const caption = document.createElement('caption');
          caption.className = 'wiki-details-caption';
          blockMatches.forEach((m, i) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'match-details-btn';
            button.textContent = blockMatches.length === 1 ? '首轮详情' : `首轮${i + 1}详情`;
            button.onclick = e => { e.stopPropagation(); showMatchDetails(m); };
            caption.appendChild(button);
            const quick = document.createElement('span');
            quick.innerHTML = window.GoViewerEditor.quick(m);
            if (quick.firstChild) caption.appendChild(quick.firstChild);
          });
          table.appendChild(caption);
        }

        table.querySelectorAll(".wiki-r1-player").forEach(cell => {
          const pName = cell.dataset.playerName;
          if (pName && !pName.includes("轮空")) {
            cell.addEventListener("mouseenter", () => highlightPlayer(pName));
            cell.addEventListener("click", (e) => {
              e.stopPropagation();
              window.showPlayer(cell.dataset.playerId || pName);
            });
          }
        });

        return table;
      }

      function createWikiR1BlockTable(mA, mB, top, blockIndex) {
        const table = document.createElement("table");
        table.className = "wiki-r1-block-table";
        table.id = `wiki-r1-block-${blockIndex}`;
        table.dataset.blockIndex = blockIndex;
        table.dataset.matchAId = mA?.id || "";
        table.dataset.matchBId = mB?.id || "";
        table.style.top = `${top}px`;

        function renderRow(m) {
          if (!m) return `<tr class="wiki-r1-row"><td colspan="5" class="wiki-r1-player text-center text-muted">轮空</td></tr>`;
          const [p1, p2] = M.participants(m);
          const winner = m.winner || {};
          const isDecided = !!winner.id;

          let adv = p1, opp = p2;
          if (isDecided && M.samePlayer(winner, p2)) {
            adv = p2;
            opp = p1;
          }

          const advName = adv.name_zh || "待定";
          const advNat = adv.nationality || "UNK";

          const oppName = opp.name_zh || "待定";
          const oppNat = opp.nationality || "UNK";

          const resultRaw = isDecided ? (M.winnerLabel(m) || '胜') : M.matchResult(m);
          const resultText = String(resultRaw).replace(/0\.25子/g, '1/4子').replace(/0\.75子/g, '3/4子');

          const advStoneTd = stoneBox(m, adv, 'td') || '<td class="player-stone wiki-stone-cell wiki-col-s1"></td>';
          const oppStoneTd = stoneBox(m, opp, 'td') || '<td class="player-stone wiki-stone-cell wiki-col-s2"></td>';

          return `
            <tr class="wiki-r1-row" data-match-id="${m.id}" id="wiki-match-${m.id}" data-next-id="${m.next_match_id || ''}" data-object-table="matches" data-object-id="${m.id}">
              <td class="wiki-r1-player wiki-col-p1 ${isDecided ? 'winner' : ''}" data-player-name="${esc(advName)}" data-player-id="${esc(adv.id || '')}">
                ${getFlagSvg(advNat)}<span class="wiki-pname">${esc(advName)}</span>
              </td>
              ${advStoneTd}
              <td class="wiki-r1-score wiki-col-res ${isDecided ? 'winner-score' : ''}" title="${esc(resultRaw)}">
                ${esc(resultText)}
              </td>
              <td class="wiki-r1-player wiki-col-p2 wiki-r1-opponent" data-player-name="${esc(oppName)}" data-player-id="${esc(opp.id || '')}">
                ${getFlagSvg(oppNat)}<span class="wiki-pname">${esc(oppName)}</span>
              </td>
              ${oppStoneTd}
            </tr>
          `;
        }

        table.innerHTML = '<colgroup><col style="width:147px"><col style="width:25px"><col style="width:76px"><col style="width:147px"><col style="width:25px"></colgroup>' + renderRow(mA) + renderRow(mB);
        const caption = document.createElement('caption');
        caption.className = 'wiki-details-caption';
        [mA, mB].forEach((m, i) => {
          if (!m) return;
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'match-details-btn';
          button.textContent = `对局${i + 1}详情`;
          button.onclick = e => { e.stopPropagation(); showMatchDetails(m); };
          caption.appendChild(button);
          const quick=document.createElement('span');quick.innerHTML=window.GoViewerEditor.quick(m);if(quick.firstChild)caption.appendChild(quick.firstChild);
        });
        table.appendChild(caption);

        table.querySelectorAll(".wiki-r1-player").forEach(cell => {
          const pName = cell.dataset.playerName;
          if (pName && !pName.includes("轮空")) {
            cell.addEventListener("mouseenter", () => highlightPlayer(pName));
            cell.addEventListener("click", (e) => {
              e.stopPropagation();
              window.showPlayer(cell.dataset.playerId || pName);
            });
          }
        });

        if (table.dataset.matchId) addDetailsButton(table, mForDetails(table.dataset.matchId));
        return table;
      }

      function createWikiMatchTable(m, top, detailOptions = {}) {
        if (detailOptions.singleGame) m = M.singleGamePresentation(m);
        const table = document.createElement("table");
        table.className = "wiki-match-table";
        table.id = `wiki-match-${m.id}`;
        table.dataset.matchId = m.id;
        table.dataset.objectTable = 'matches'; table.dataset.objectId = m.id;
        table.dataset.nextId = m.next_match_id || "";
        table.style.top = `${top}px`;

        const isSeries = Boolean(m.isSeries || m.series_score);
        if (isSeries && (m.tooltip || m.series_score)) {
          table.title = m.tooltip ? `半决赛番棋 (${m.series_score}):\n${m.tooltip}` : `半决赛番棋 (${m.series_score})`;
        }

        const [p1, p2] = M.participants(m);
        const winner = m.winner || {};

        const p1Name = p1.name_zh || "轮空/待定";
        const p2Name = p2.name_zh || "轮空/待定";
        const p1Nat = p1.nationality || "UNK";
        const p2Nat = p2.nationality || "UNK";

        const isP1Win = M.samePlayer(winner, p1);
        const isP2Win = M.samePlayer(winner, p2);

        let p1Score = '', p2Score = '';
        if (isSeries) {
          const numeric = /^(\d+)-(\d+)$/.exec(m.series_score || '');
          const wScore = m.winner_score ?? (numeric ? numeric[1] : '');
          const lScore = m.loser_score ?? (numeric ? numeric[2] : '');
          p1Score = m.player_scores?.[0] ?? (isP1Win ? wScore : (isP2Win ? lScore : ''));
          p2Score = m.player_scores?.[1] ?? (isP2Win ? wScore : (isP1Win ? lScore : ''));
        } else {
          p1Score = isP1Win ? M.winnerLabel(m) : '';
          p2Score = isP2Win ? M.winnerLabel(m) : '';
        }

        table.innerHTML = `
          <tr class="wiki-player-row ${isP1Win ? 'winner' : ''}" data-player-name="${esc(p1Name)}" data-player-id="${esc(p1.id || '')}">
            <td class="wiki-name-td">${p1.id ? getFlagSvg(p1Nat) : ''}<span class="wiki-pname">${esc(p1Name)}</span></td>
            <td class="wiki-score-td ${isP1Win ? 'winner-score' : ''}" title="${esc(M.matchResult(m))}">${esc(p1Score)}</td>${stoneBox(m,p1,'td')}
          </tr>
          <tr class="wiki-player-row ${isP2Win ? 'winner' : ''}" data-player-name="${esc(p2Name)}" data-player-id="${esc(p2.id || '')}">
            <td class="wiki-name-td">${p2.id ? getFlagSvg(p2Nat) : ''}<span class="wiki-pname">${esc(p2Name)}</span></td>
            <td class="wiki-score-td ${isP2Win ? 'winner-score' : ''}" title="${esc(M.matchResult(m))}">${esc(p2Score)}</td>${stoneBox(m,p2,'td')}
          </tr>
        `;

        table.querySelectorAll(".wiki-player-row").forEach(row => {
          const pName = row.dataset.playerName;
          if (pName && !pName.includes("轮空")) {
            row.addEventListener("mouseenter", () => highlightPlayer(pName));
            row.addEventListener("click", (e) => {
              e.stopPropagation();
              if (row.dataset.playerId) window.showPlayer(row.dataset.playerId);
            });
          }
        });

        if (isSeries) {
          const row = table.insertRow(); row.className = 'series-footer';
          const cell = row.insertCell(); cell.colSpan = 2;
          cell.innerHTML = `<div class="series-footer-content">${seriesMarks(m)}<span class="series-actions"></span></div>`;
        } else if (table.dataset.matchId) addDetailsButton(table, m, detailOptions);
        return table;
      }

      // Standalone 3rd Place Match Box (Wiki Mode, No Connector Lines)
      function createWikiThirdPlaceBox(m, top) {
        const container = document.createElement("div");
        container.className = "wiki-third-place-box";
        container.style.position = "absolute";
        container.style.top = `${top}px`;
        container.style.left = "0";
        container.style.right = "0";

        const p1 = m.black_player?.id ? m.black_player : (m.participant_1 || {});
        const p2 = m.white_player?.id ? m.white_player : (m.participant_2 || {});
        const winner = m.winner || {};

        const p1Name = p1.name_zh || "轮空/待定";
        const p2Name = p2.name_zh || "轮空/待定";
        const p1Nat = p1.nationality || "UNK";
        const p2Nat = p2.nationality || "UNK";

        const isP1Win = M.samePlayer(winner, p1);
        const isP2Win = M.samePlayer(winner, p2);

        const dateStr = m.date ? ` <span style="font-size:10px;font-weight:normal;color:var(--text-muted);">(${esc(m.date)})</span>` : '';

        container.innerHTML = `
          <div class="wiki-third-title">三四名决赛${dateStr}</div>
          <table class="wiki-match-table wiki-third-table" id="wiki-match-${m.id}" data-match-id="${m.id}" data-next-id="" data-object-table="matches" data-object-id="${m.id}">
            <tr class="wiki-player-row ${isP1Win ? 'winner' : ''}" data-player-name="${esc(p1Name)}" data-player-id="${esc(p1.id || '')}">
              <td class="wiki-name-td">${getFlagSvg(p1Nat)}<span class="wiki-pname">${esc(p1Name)}</span></td>
              <td class="wiki-score-td ${isP1Win ? 'winner-score' : ''}" title="${esc(M.matchResult(m))}">${esc(isP1Win ? M.winnerLabel(m) : '')}</td>${stoneBox(m,p1,'td')}
            </tr>
            <tr class="wiki-player-row ${isP2Win ? 'winner' : ''}" data-player-name="${esc(p2Name)}" data-player-id="${esc(p2.id || '')}">
              <td class="wiki-name-td">${getFlagSvg(p2Nat)}<span class="wiki-pname">${esc(p2Name)}</span></td>
              <td class="wiki-score-td ${isP2Win ? 'winner-score' : ''}" title="${esc(M.matchResult(m))}">${esc(isP2Win ? M.winnerLabel(m) : '')}</td>${stoneBox(m,p2,'td')}
            </tr>
          </table>
        `;

        container.querySelectorAll(".wiki-player-row").forEach(row => {
          const pName = row.dataset.playerName;
          if (pName && !pName.includes("轮空")) {
            row.addEventListener("mouseenter", () => highlightPlayer(pName));
            row.addEventListener("click", (e) => {
              e.stopPropagation();
              if (row.dataset.playerId) window.showPlayer(row.dataset.playerId);
            });
          }
        });

        const thirdTable = container.querySelector('table');
        addDetailsButton(thirdTable, m);
        return container;
      }

      function createWikiFinalsTable(round, meta, data, top, horizontal = false) {
        const summary = M.finalSeries(round, data);
        if (!summary) return createWikiMatchTable(round.matches[0], top);
        return summary.isSeries || summary.series_score
          ? createSeriesNode(summary, true, top, horizontal) : createWikiMatchTable(summary, top);
      }

      // ----------------------------------------------------
      // View Mode C: Stage Draw Board (Bottom-to-Top Date-Grouped Exhibition)
      // ----------------------------------------------------
      function formatDrawDateLabel(value, editionYear) {
        if (!value || value === '—') return '';
        const text = String(value).trim();
        const yearPrefix = editionYear ? new RegExp('\\b' + String(editionYear) + '-', 'g') : null;
        return yearPrefix ? text.replace(yearPrefix, '') : text;
      }

      function isHorizontalDrawName(name) {
        const text = String(name || '').trim();
        return !text || text === '—' || /[A-Za-z0-9]/.test(text) || text.length > 6;
      }

      function renderDrawSlip(m, p, winnerId) {
        const hasPlayer = Boolean(p && (p.id || p.name_zh));
        const name = p?.name_zh || '—';
        const won = Boolean(winnerId && p?.id && winnerId === p.id);
        const color = !(m.isSeries || m.series_score) && p?.id
          ? (m.black_player_id === p.id ? 'black' : m.white_player_id === p.id ? 'white' : '') : '';
        const rank = M.formatRank(color ? m[color + '_rank'] : '');
        const tag = p?.id ? 'button' : 'div';
        const horizontal = isHorizontalDrawName(name);
        const attrs = p?.id
          ? `type="button" data-player-id="${esc(p.id)}" data-player-name="${esc(name)}"`
          : `data-player-name="${esc(hasPlayer ? name : '')}"`;
        return `<${tag} class="draw-player-slip${won ? ' is-winner' : ''}${!hasPlayer ? ' is-empty' : ''}" ${attrs}>
          <span class="draw-slip-flag">${p?.id ? getFlagSvg(p.nationality) : ''}</span>
          <span class="draw-slip-name${horizontal ? ' is-horizontal-name' : ''}" title="${esc(name)}">${esc(name)}</span>
          <span class="draw-slip-meta">${color ? `<i class="stone-icon stone-${color}" title="执${color === 'black' ? '黑' : '白'}" aria-label="执${color === 'black' ? '黑' : '白'}"></i>` : ''}${rank ? `<span class="draw-slip-rank">${esc(rank)}</span>` : ''}</span>
        </${tag}>`;
      }

      function renderDrawBoardBracket(data, roundsView = extractRoundsData(data)) {
        canvas.querySelectorAll('.round-col, .draw-board').forEach(el => el.remove());
        const mainRounds = roundsView.mainRounds || [];
        const {thirdPlaceRound} = roundsView;
        if (!mainRounds.length) return;

        const board = document.createElement('div');
        board.className = 'draw-board';
        const editionYear = data.edition?.year;
        const finalRound = mainRounds.find(isFinalRoundName);
        const finalId = finalRound?.matches[0]?.id;

        mainRounds.forEach((round, rIndex) => {
          const isFinal = isFinalRoundName(round);
          const isSf = isSemifinalRoundName(round);
          const cleanTitle = M.roundDisplayName(round) || `第${rIndex + 1}轮`;

          if (isFinal) {
            const summary = M.finalSeries(round, data);
            const games = summary?.subgames || round.matches || [];
            const row = document.createElement('section');
            row.className = 'draw-stage-row draw-final-stage';
            row.dataset.roundId = round.id;
            row.dataset.roundOrder = round.round_order;

            const finalDate = formatDrawDateLabel(round.date_range || games[0]?.date || '', editionYear);
            const finalsType = data.edition?.finals_type || '';
            const plaqueHtml = `<div class="draw-group-plaque draw-final-plaque"${round.source_rounds ? '' : ` data-object-table="rounds" data-object-id="${esc(round.id)}" role="button" tabindex="0"`} title="${round.source_rounds ? '按赛制合并显示的原始赛段' : '编辑赛段资料'}">
              <span class="draw-plaque-round">${esc(cleanTitle)}</span>
              ${finalDate ? `<span class="draw-plaque-date">${esc(finalDate)}</span>` : ''}
              ${finalsType ? `<span class="draw-plaque-date">${esc(finalsType)}</span>` : ''}
            </div>`;

            const targetMatch = summary || games[0];
            const champion = data.champion?.id ? data.champion
              : (summary?.isFinalSeries || M.isSingleGameFinal(data) ? summary?.winner : null);
            const championName = champion?.name_zh || '';
            const scoreLabel = data.edition?.finals_score || summary?.series_score || '';
            const pairPlayers = targetMatch ? M.participants(targetMatch) : [{}, {}];
            const matchId = targetMatch?.id || round.id;

            const unit = document.createElement('div');
            unit.className = 'draw-final-unit';
            unit.id = 'draw-match-' + matchId;
            unit.dataset.matchId = matchId;
            unit.innerHTML = `
              ${champion?.id ? `<div class="draw-winner-box draw-champion-box is-decided" data-player-name="${esc(championName)}" data-player-id="${esc(champion.id)}">
                <div class="draw-winner-main">
                  ${getFlagSvg(champion.nationality)}
                  <span class="draw-winner-name">${esc(championName)}</span>
                </div>
                ${scoreLabel ? `<div class="draw-winner-result">${esc(scoreLabel)}</div>` : ''}
              </div>
              <div class="draw-final-stem" aria-hidden="true"></div>` : ''}
              <div class="draw-final-matchup">
                <div class="draw-final-pair">
                  ${pairPlayers.map(p => {
                    const pName = p?.name_zh || '—';
                    const isChamp = Boolean(champion?.id && p?.id === champion.id);
                    const tag = p?.id ? 'button' : 'span';
                    return `<${tag} ${p?.id ? `type="button" data-player-id="${esc(p.id)}"` : ''} class="draw-final-player${isChamp ? ' is-winner' : ''}${!p?.id && !p?.name_zh ? ' is-empty' : ''}" data-player-name="${esc(p?.id ? pName : '')}">${p?.id ? getFlagSvg(p.nationality) : ''}<span>${esc(pName)}</span></${tag}>`;
                  }).join('<span class="draw-final-vs">vs</span>')}
                </div>
                ${games.length ? `<div class="draw-final-games">${games.map((g, idx) => {
                  const st = M.matchStatus(g);
                  const text = st === 'no_result' ? '无胜负' : st === 'scheduled' ? '待赛' : st === 'pending' ? '—' : (g.winner?.name_zh ? `${g.winner.name_zh}胜` : M.winnerLabel(g));
                  const label = /^FINAL(?:-\d+)?$/i.test(g.bracket_code || '') ? `第${idx + 1}局` : M.seriesGameLabel(g, idx);
                  return `<button type="button" class="draw-final-game-chip" data-final-game-id="${esc(g.id)}" data-final-game-index="${idx}" title="${esc(M.dateLabel(g.date))} · ${esc(M.matchResult(g))}">${esc(label)} · ${esc(text)}</button>`;
                }).join('')}</div>` : ''}
                ${targetMatch ? `<div class="draw-unit-actions"><button type="button" class="match-details-btn">详情</button></div>` : ''}
              </div>`;

            unit.querySelector('.draw-champion-box')?.addEventListener('click', () => {
              if (champion?.id) window.showPlayer(champion.id);
            });
            unit.querySelectorAll('[data-player-id]').forEach(el => {
              el.addEventListener('mouseenter', () => highlightPlayer(el.dataset.playerName));
              el.addEventListener('click', e => { e.stopPropagation(); window.showPlayer(el.dataset.playerId); });
            });
            unit.querySelectorAll('[data-final-game-id]').forEach(btn => {
              btn.addEventListener('click', e => {
                e.stopPropagation();
                const g = games.find(item => item.id === btn.dataset.finalGameId);
                if (g) showMatchDetails(M.singleGamePresentation(g), {singleGame: true, gameNumber: Number(btn.dataset.finalGameIndex)});
              });
            });
            unit.querySelector('.match-details-btn')?.addEventListener('click', e => {
              e.stopPropagation();
              if (summary && games.length > 1) showMatchDetails(summary);
              else if (targetMatch) showMatchDetails(targetMatch);
            });

            const wrap = document.createElement('div');
            wrap.className = 'draw-final-row';
            wrap.append(plaqueHtml ? (() => { const d = document.createElement('div'); d.innerHTML = plaqueHtml; return d.firstElementChild; })() : '', unit);

            if (thirdPlaceRound?.matches?.length) {
              const tm = thirdPlaceRound.matches[0];
              const [tp1, tp2] = M.participants(tm);
              const tw = tm.winner?.id ? tm.winner : {};
              const thirdBox = document.createElement('div');
              thirdBox.className = 'draw-third-unit';
              thirdBox.id = 'draw-match-' + tm.id;
              thirdBox.dataset.matchId = tm.id;
              thirdBox.dataset.objectTable = 'matches';
              thirdBox.dataset.objectId = tm.id;
              thirdBox.innerHTML = `
                <div class="draw-third-title">三四名决赛</div>
                <div class="draw-winner-box${tw.id ? ' is-decided' : ''}" data-player-name="${esc(tw.id ? tw.name_zh : '')}">
                  <div class="draw-winner-main">${tw.id ? getFlagSvg(tw.nationality) : ''}<span class="draw-winner-name">${esc(tw.name_zh || '—')}</span></div>
                  <div class="draw-winner-result">${esc(tw.id ? M.winnerLabel(tm) : M.matchResult(tm))}</div>
                </div>
                <div class="draw-final-pair">
                  ${[tp1, tp2].map(p => {
                    const pName = p?.name_zh || '—';
                    const tag = p?.id ? 'button' : 'span';
                    return `<${tag} ${p?.id ? `type="button" data-player-id="${esc(p.id)}"` : ''} class="draw-final-player${tw.id && p?.id === tw.id ? ' is-winner' : ''}" data-player-name="${esc(p?.id ? pName : '')}">${p?.id ? getFlagSvg(p.nationality) : ''}<span>${esc(pName)}</span></${tag}>`;
                  }).join('<span class="draw-final-vs">vs</span>')}
                </div>
                <div class="draw-unit-actions"><button type="button" class="match-details-btn">详情</button></div>`;
              thirdBox.querySelectorAll('[data-player-id]').forEach(el => {
                el.addEventListener('mouseenter', () => highlightPlayer(el.dataset.playerName));
                el.addEventListener('click', e => { e.stopPropagation(); window.showPlayer(el.dataset.playerId); });
              });
              thirdBox.querySelector('.match-details-btn')?.addEventListener('click', e => { e.stopPropagation(); showMatchDetails(tm); });
              wrap.appendChild(thirdBox);
            }
            row.appendChild(wrap);
            board.appendChild(row);
            return;
          }

          const roundMatches = isSf ? aggregateSemifinalMatches(round, finalId) : (round.matches || []);
          const groups = M.groupRoundMatchesForDrawView(round, roundMatches);
          const row = document.createElement('section');
          row.className = 'draw-stage-row' + (isSf ? ' draw-sf-stage' : '');
          row.dataset.roundId = round.id;
          row.dataset.roundOrder = round.round_order;

          const groupsWrap = document.createElement('div');
          groupsWrap.className = 'draw-stage-groups';

          groups.forEach(group => {
            const groupEl = document.createElement('div');
            groupEl.className = 'draw-date-group';
            if (group.matches.length > 8) groupEl.classList.add('is-multi-row');
            const dateLabel = formatDrawDateLabel(group.label, editionYear);

            const plaque = document.createElement('div');
            plaque.className = 'draw-group-plaque';
            if (!round.source_rounds) {
              plaque.dataset.objectTable = 'rounds';
              plaque.dataset.objectId = round.id;
              plaque.setAttribute('role', 'button');
              plaque.tabIndex = 0;
              plaque.title = '编辑赛段资料';
            }
            plaque.innerHTML = `<span class="draw-plaque-round">${esc(cleanTitle)}</span>${dateLabel ? `<span class="draw-plaque-date">${esc(dateLabel)}</span>` : ''}`;

            const unitsEl = document.createElement('div');
            unitsEl.className = 'draw-group-units';
            if (group.matches.length > 8) unitsEl.classList.add('is-multi-row');

            const canReorderGroup = group.matches.length > 1 && group.matches.every(item => !item.isSeries && !item.series_score);

            group.matches.forEach((m, idx) => {
              const [p1, p2] = M.participants(m);
              const winnerId = m.winner?.id || m.winner_id || '';
              const winnerPlayer = winnerId ? ([p1, p2].find(p => p?.id === winnerId) || m.winner) : null;
              const isSeries = Boolean(m.isSeries || m.series_score);
              const status = M.matchStatus(m);
              const winnerName = winnerPlayer?.name_zh || '—';
              const resultNote = winnerId
                ? (isSeries && m.series_score ? m.series_score : M.winnerLabel(m))
                : (status === 'no_result' ? '无胜负' : status === 'scheduled' ? '待赛' : '');

              const p1Win = Boolean(winnerId && p1?.id === winnerId);
              const p2Win = Boolean(winnerId && p2?.id === winnerId);
              const forkLeft = `<path class="draw-fork-branch${p1Win ? ' is-winner-branch' : ''}" data-player-name="${esc(p1?.id ? p1.name_zh : '')}" d="M 25 22 V 11 H 50 V 0"/>`;
              const forkRight = `<path class="draw-fork-branch${p2Win ? ' is-winner-branch' : ''}" data-player-name="${esc(p2?.id ? p2.name_zh : '')}" d="M 75 22 V 11 H 50 V 0"/>`;
              const forkPaths = p1Win ? forkRight + forkLeft : forkLeft + forkRight;

              const unit = document.createElement('div');
              unit.className = 'draw-match-unit' + (isSeries ? ' is-series' : '');
              unit.id = 'draw-match-' + m.id;
              unit.dataset.matchId = m.id;
              if (!isSeries) {
                unit.dataset.objectTable = 'matches';
                unit.dataset.objectId = m.id;
              }
              if (isSf) unit.dataset.sfUnit = '1';

              const prevLocked = idx > 0 && Boolean(group.matches[idx - 1]?.review_locked);
              const nextLocked = idx < group.matches.length - 1 && Boolean(group.matches[idx + 1]?.review_locked);
              const reorderHtml = canReorderGroup
                ? `<button type="button" class="draw-reorder-btn edit-only" data-draw-move="-1" ${idx === 0 || m.review_locked || prevLocked ? 'disabled' : ''} title="${m.review_locked ? '用户指定保留' : '签位左移'}" aria-label="签位左移">◀</button><button type="button" class="draw-reorder-btn edit-only" data-draw-move="1" ${idx === group.matches.length - 1 || m.review_locked || nextLocked ? 'disabled' : ''} title="${m.review_locked ? '用户指定保留' : '签位右移'}" aria-label="签位右移">▶</button>`
                : '';

              unit.innerHTML = `
                <div class="draw-winner-box${winnerId ? ' is-decided' : ''}" data-player-name="${esc(winnerId ? winnerName : '')}">
                  <div class="draw-winner-main">
                    ${winnerId && winnerPlayer ? getFlagSvg(winnerPlayer.nationality) : ''}
                    <span class="draw-winner-name">${esc(winnerName)}</span>
                  </div>
                  ${resultNote ? `<div class="draw-winner-result" title="${esc(M.matchResult(m))}">${esc(resultNote)}</div>` : ''}
                  ${isSeries && m.subgames?.length ? `<div class="draw-series-marks">${seriesMarks(m)}</div>` : ''}
                </div>
                <svg class="draw-unit-fork" viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true">${forkPaths}</svg>
                <div class="draw-unit-players">
                  ${renderDrawSlip(m, p1, winnerId)}
                  ${renderDrawSlip(m, p2, winnerId)}
                </div>
                <div class="draw-unit-actions">
                  ${reorderHtml}
                  <button type="button" class="match-details-btn">详情</button>
                  ${window.GoViewerEditor.quick(m)}
                </div>`;

              unit.querySelectorAll('.draw-player-slip').forEach(el => {
                const pName = el.dataset.playerName;
                if (pName) el.addEventListener('mouseenter', () => highlightPlayer(pName));
                if (el.dataset.playerId) {
                  el.addEventListener('click', e => { e.stopPropagation(); window.showPlayer(el.dataset.playerId); });
                }
              });
              unit.querySelector('.draw-winner-box')?.addEventListener('mouseenter', e => {
                const pName = e.currentTarget.dataset.playerName;
                if (pName) highlightPlayer(pName);
              });
              unit.querySelector('.match-details-btn')?.addEventListener('click', e => {
                e.stopPropagation();
                showMatchDetails(m);
              });
              unit.querySelectorAll('[data-draw-move]').forEach(btn => {
                btn.addEventListener('click', e => {
                  e.stopPropagation();
                  const step = Number(btn.dataset.drawMove);
                  const targetIdx = idx + step;
                  if (targetIdx < 0 || targetIdx >= group.matches.length) return;
                  const reordered = group.matches.slice();
                  [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]];
                  window.GoViewerEditor?.saveDrawOrder?.(reordered.map((item, pos) => ({id: item.id, draw_order: pos + 1})));
                });
              });

              unitsEl.appendChild(unit);
            });

            groupEl.append(plaque, unitsEl);
            groupsWrap.appendChild(groupEl);
          });

          row.appendChild(groupsWrap);
          board.appendChild(row);
        });

        canvas.appendChild(board);
      }

      function drawDrawBoardConnectors() {
        svg.innerHTML = '';
        const canvasRect = canvas.getBoundingClientRect();
        const actualZoom = canvasRect.width / canvas.offsetWidth || zoomLevel;
        const width = Math.max(canvas.scrollWidth, canvas.offsetWidth);
        const height = Math.max(canvas.scrollHeight, canvas.offsetHeight);
        svg.setAttribute('width', width); svg.setAttribute('height', height);
        svg.style.width = width + 'px'; svg.style.height = height + 'px';

        const finalUnit = canvas.querySelector('.draw-final-unit');
        const sfUnits = [...canvas.querySelectorAll('.draw-match-unit[data-sf-unit="1"]')];
        if (!finalUnit || sfUnits.length !== 2) return;
        const targetBox = finalUnit.querySelector('.draw-final-matchup') || finalUnit;
        const b = targetBox.getBoundingClientRect();
        const x2 = (b.left + b.width / 2 - canvasRect.left) / actualZoom;
        const y2 = (b.bottom - canvasRect.top) / actualZoom;

        sfUnits.forEach(sfUnit => {
          const sourceBox = sfUnit.querySelector('.draw-winner-box') || sfUnit;
          const a = sourceBox.getBoundingClientRect();
          const x1 = (a.left + a.width / 2 - canvasRect.left) / actualZoom;
          const y1 = (a.top - canvasRect.top) / actualZoom;
          const mid = (y1 + y2) / 2;
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', `M ${x1} ${y1} V ${mid} H ${x2} V ${y2}`);
          path.setAttribute('class', 'connector-path');
          path.dataset.sourceId = sfUnit.dataset.matchId || '';
          path.dataset.targetId = finalUnit.dataset.matchId || '';
          path.dataset.playerName = sourceBox.dataset.playerName || '';
          svg.appendChild(path);
        });
      }

      // Draw SVG Connectors (Dispatches to Modern, Wiki, or Draw Board)
      function drawConnectors() {
        if (currentViewMode === "draw") {
          drawDrawBoardConnectors();
        } else if (currentViewMode === "wiki") {
          drawWikiConnectors();
        } else {
          drawModernConnectors();
        }
      }

      // Confirmed binary trees use right-angle forks in both presentations.
      function drawModernConnectors() { drawVerifiedConnectors(false); }
      function drawWikiConnectors() { drawVerifiedConnectors(true); }
      // Wiki tables carry a "详情" caption below the two player rows. Anchor the
      // connector on the rows themselves so the line meets the middle of the box
      // body instead of the caption strip below it.
      function connectorAnchor(el) {
        if (el.classList.contains('series-node')) return connectorAnchor(el.firstElementChild);
        const r = el.getBoundingClientRect();
        if (el.tagName === 'TABLE') {
          const rows = el.querySelectorAll('tr:not(.series-footer)');
          if (rows.length) {
            const first = rows[0].getBoundingClientRect();
            const last = rows[rows.length - 1].getBoundingClientRect();
            return { left: r.left, right: r.right, top: first.top, height: last.bottom - first.top, width: r.width, bottom: last.bottom };
          }
        }
        return { left: r.left, right: r.right, top: r.top, height: r.height, width: r.width, bottom: r.bottom };
      }
      function drawVerifiedConnectors(wiki) {
        svg.innerHTML = '';
        const vertical = currentOrientation === 'vertical';
        const canvasRect = canvas.getBoundingClientRect();
        const actualZoom = canvasRect.width / canvas.offsetWidth || zoomLevel;
        const width = Math.max(canvas.scrollWidth, canvas.offsetWidth);
        const height = Math.max(canvas.scrollHeight, canvas.offsetHeight);
        svg.setAttribute('width', width); svg.setAttribute('height', height);
        svg.style.width = width + 'px'; svg.style.height = height + 'px';
        const doubleNodes = canvas.dataset.doubleElimination === 'true'
          ? [...canvas.querySelectorAll('.modern-stage > *, .wiki-matches-stage > *')]
            .filter(el => !el.classList.contains('third-place-container') && !el.classList.contains('wiki-third-place-box'))
          : [];
        const appendConnector = (path, edge) => {
          path.setAttribute('class', 'connector-path' + (edge.kind === 'loser' ? ' connector-loser' : edge.kind === 'scheduled' ? ' connector-scheduled' : ''));
          path.dataset.sourceId = edge.sourceId; path.dataset.sourceIds = edge.sourceId;
          path.dataset.targetId = edge.targetId; path.dataset.playerName = edge.player;
          svg.appendChild(path);
        };
        const prefix = wiki ? 'wiki-match-' : 'match-';
        const plans = [];
        for (const edge of currentEdges) {
          const source = document.getElementById(prefix + edge.sourceId);
          const target = document.getElementById(prefix + edge.targetId);
          if (source && target) plans.push({edge, source, target, a: connectorAnchor(source), b: connectorAnchor(target)});
        }
        // Routes entering the same game share a fork. Distinct forks can use
        // separate tracks, while overlapping loser strokes share a dash phase.
        const clearRoute = (plan, points) => points.slice(1).every((p, i) => {
          const q = points[i];
          return plan.boxes.every(box => p[0] === q[0]
            ? !(p[0] > box.u0 - 2 && p[0] < box.u1 + 2 && Math.max(p[1],q[1]) > box.v0 - 2 && Math.min(p[1],q[1]) < box.v1 + 2)
            : !(p[1] > box.v0 - 2 && p[1] < box.v1 + 2 && Math.max(p[0],q[0]) > box.u0 - 2 && Math.min(p[0],q[0]) < box.u1 + 2));
        });
        const routeAt = (plan, mid) => [[plan.u1,plan.v1],[mid,plan.v1],[mid,plan.v2],[plan.u2,plan.v2]];
        if (doubleNodes.length) {
          const coord = (r, key) => (r[key] - (key === 'left' || key === 'right' ? canvasRect.left : canvasRect.top)) / actualZoom;
          const gutters = new Map();
          for (const plan of plans) {
            const a = plan.a, b = plan.b;
            plan.u1 = coord(a, vertical ? 'bottom' : 'right');
            plan.u2 = coord(b, vertical ? 'top' : 'left');
            plan.v1 = vertical ? (coord(a, 'left') + coord(a, 'right')) / 2 : (coord(a, 'top') + coord(a, 'bottom')) / 2;
            plan.v2 = vertical ? (coord(b, 'left') + coord(b, 'right')) / 2 : (coord(b, 'top') + coord(b, 'bottom')) / 2;
            plan.boxes = doubleNodes.filter(n => !n.contains(plan.source) && !n.contains(plan.target)).map(n => {
              const r = n.getBoundingClientRect();
              return {u0:coord(r, vertical ? 'top' : 'left'), u1:coord(r, vertical ? 'bottom' : 'right'),
                v0:coord(r, vertical ? 'left' : 'top'), v1:coord(r, vertical ? 'right' : 'bottom')};
            });
            // Start the track band at the column edge nearest the target, so a
            // route that skips a parallel round stays out of that round's boxes.
            const previousEdge = Math.max(plan.u1, ...plan.boxes.filter(box => box.u1 < plan.u2 - 2).map(box => box.u1));
            plan.left = Math.max(plan.u1, previousEdge);
            const key = Math.round(plan.u2);
            if (!gutters.has(key)) gutters.set(key, []);
            gutters.get(key).push(plan);
          }
          for (const plans of gutters.values()) {
            const targets = new Map();
            for (const plan of plans) {
              if (!targets.has(plan.edge.targetId)) targets.set(plan.edge.targetId, []);
              targets.get(plan.edge.targetId).push(plan);
            }
            const ordered = [...targets.values()].map(group => ({group,
              lo: Math.min(...group.flatMap(plan => [plan.v1, plan.v2])),
              hi: Math.max(...group.flatMap(plan => [plan.v1, plan.v2]))}))
              .sort((x, y) => x.lo - y.lo || x.hi - y.hi);
            const tracks = [];
            for (const item of ordered) {
              let index = tracks.findIndex(used => used.every(([lo, hi]) => item.hi < lo - 4 || item.lo > hi + 4));
              if (index < 0) { tracks.push([]); index = tracks.length - 1; }
              tracks[index].push([item.lo, item.hi]);
              item.track = index;
            }
            const room = Math.max(10, ...plans.map(plan => plan.u2 - plan.left - 12));
            const pitch = tracks.length > 1 ? Math.min(7, Math.max(3, Math.floor(room / (tracks.length - 1)))) : 0;
            const span = pitch * (tracks.length - 1);
            for (const item of ordered) {
              const left = Math.min(Math.max(...item.group.map(plan => plan.left)), item.group[0].u2 - 8);
              const end = item.group[0].u2;
              const start = left + Math.max(4, (end - left - 8 - span) / 2);
              const preferred = Math.min(end - 5, start + item.track * pitch);
              const candidates = [preferred, end - 12, (left + end) / 2, left + 4];
              const shared = candidates.find(mid => item.group.every(plan => clearRoute(plan, routeAt(plan, mid))));
              for (const plan of item.group) plan.trackX = shared ?? preferred;
            }
          }
        }
        const clean = points => points.filter((point, index) => index === 0
          || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]);
        for (const plan of plans) {
          const {edge, a, b, u1, u2, v1, v2} = plan;
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          if (doubleNodes.length) {
            const candidates = [plan.trackX, (u1 + u2) / 2, u1 + 12, u2 - 12]
              .map(mid => clean([[u1,v1],[mid,v1],[mid,v2],[u2,v2]]));
            const found = candidates.find(points => clearRoute(plan, points));
            const gutter = Math.max(v1, v2, ...plan.boxes.map(box => box.v1)) + 16;
            const points = clean(found || [[u1,v1],[u1+12,v1],[u1+12,gutter],[u2-12,gutter],[u2-12,v2],[u2,v2]]);
            if (edge.kind === 'loser') {
              // Give each straight segment a canvas-aligned dash phase. Shared
              // segments then have the same gaps even when routes start at
              // different games or traverse the segment in opposite directions.
              for (let i = 1; i < points.length; i++) {
                let [x1,y1] = vertical ? [points[i-1][1],points[i-1][0]] : points[i-1];
                let [x2,y2] = vertical ? [points[i][1],points[i][0]] : points[i];
                if (x1 === x2 && y1 === y2) continue;
                if (x2 < x1 || y2 < y1) { [x1,x2] = [x2,x1]; [y1,y2] = [y2,y1]; }
                const segment = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                segment.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`);
                segment.style.strokeDashoffset = `${x1 === x2 ? y1 : x1}px`;
                appendConnector(segment, edge);
              }
              continue;
            }
            path.setAttribute('d', points.map(([u,v], i) => `${i ? 'L' : 'M'} ${vertical ? v : u} ${vertical ? u : v}`).join(' '));
          } else if (vertical) {
            const x1 = (a.left + a.width / 2 - canvasRect.left) / actualZoom;
            const y1 = (a.bottom - canvasRect.top) / actualZoom;
            const x2 = (b.left + b.width / 2 - canvasRect.left) / actualZoom;
            const y2 = (b.top - canvasRect.top) / actualZoom;
            const mid = (y1 + y2) / 2;
            path.setAttribute('d', Math.abs(x2 - x1) < 0.75 ? `M ${x1} ${y1} V ${y2}` :
              wiki || canvas.dataset.binaryTree === 'true' ? `M ${x1} ${y1} V ${mid} H ${x2} V ${y2}` :
              `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`);
          } else {
            const x1 = (a.right - canvasRect.left) / actualZoom;
            const y1 = (a.top + a.height / 2 - canvasRect.top) / actualZoom;
            const x2 = (b.left - canvasRect.left) / actualZoom;
            const y2 = (b.top + b.height / 2 - canvasRect.top) / actualZoom;
            const mid = (x1 + x2) / 2;
            // 单线接力的两端对齐后直接横连，不再画一段无意义的台阶。
            path.setAttribute('d', Math.abs(y2 - y1) < 0.75 ? `M ${x1} ${y1} H ${x2}` :
              wiki || canvas.dataset.binaryTree === 'true' ? `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}` :
              `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
          }
          appendConnector(path, edge);
        }
      }

      // Highlight Player's Path
      function highlightPlayer(playerName) {
        if (!playerName || playerName === "轮空 / 待定" || playerName.includes("轮空")) return;
        activeHighlightPlayer = playerName;
        const clearBtn = document.getElementById('btnHighlightClear');
        if (clearBtn) {
          clearBtn.disabled = false;
          clearBtn.textContent = `${playerName} ×`;
          clearBtn.setAttribute('aria-label', `清除 ${playerName} 的高亮`);
        }

        if (currentViewMode === "draw") {
          highlightDrawPlayer(playerName);
        } else if (currentViewMode === "wiki") {
          highlightWikiPlayer(playerName);
        } else {
          highlightModernPlayer(playerName);
        }
      }

      function highlightDrawPlayer(playerName) {
        const escaped = CSS.escape(playerName);
        canvas.querySelectorAll('.draw-match-unit, .draw-final-unit, .draw-third-unit').forEach(unit => {
          const hit = unit.querySelector(`[data-player-name="${escaped}"]`);
          unit.classList.toggle('highlight', Boolean(hit));
          unit.classList.toggle('dimmed', !hit);
        });
        canvas.querySelectorAll('.draw-player-slip, .draw-winner-box, .draw-final-player, .draw-fork-branch').forEach(el => {
          el.classList.toggle('highlight-player', el.dataset.playerName === playerName);
        });
        svg.querySelectorAll('.connector-path').forEach(p => {
          p.classList.toggle('highlight', p.dataset.playerName === playerName);
        });
      }

      function clearDrawHighlight() {
        canvas.querySelectorAll('.draw-match-unit, .draw-final-unit, .draw-third-unit').forEach(unit => {
          unit.classList.remove('highlight', 'dimmed');
        });
        canvas.querySelectorAll('.draw-player-slip, .draw-winner-box, .draw-final-player, .draw-fork-branch').forEach(el => {
          el.classList.remove('highlight-player');
        });
        svg.querySelectorAll('.connector-path').forEach(p => p.classList.remove('highlight'));
      }

      function highlightModernPlayer(playerName) {
        const allCards = canvas.querySelectorAll(".match-card");
        allCards.forEach(card => {
          const hasPlayer = card.querySelector(`[data-player-name="${CSS.escape(playerName)}"]`);
          if (hasPlayer) {
            card.classList.add("highlight");
            card.classList.remove("dimmed");
          } else {
            card.classList.remove("highlight");
            card.classList.add("dimmed");
          }
        });

        const paths = svg.querySelectorAll(".connector-path");
        paths.forEach(p => {
          const srcCard = document.getElementById(`match-${p.dataset.sourceId}`);
          const tgtCard = document.getElementById(`match-${p.dataset.targetId}`);
          const srcHas = srcCard && srcCard.querySelector(`[data-player-name="${CSS.escape(playerName)}"]`);
          const tgtHas = tgtCard && tgtCard.querySelector(`[data-player-name="${CSS.escape(playerName)}"]`);

          if (p.dataset.playerName === playerName && srcHas && tgtHas) {
            p.classList.add("highlight");
          } else {
            p.classList.remove("highlight");
          }
        });
      }

      function highlightWikiPlayer(playerName) {
        const rows = canvas.querySelectorAll(".wiki-player-row, .wiki-r1-player");
        rows.forEach(r => {
          if (r.dataset.playerName === playerName) {
            r.classList.add("highlight-player");
            r.classList.remove("dimmed-player");
          } else {
            r.classList.remove("highlight-player");
            r.classList.add("dimmed-player");
          }
        });

        const paths = svg.querySelectorAll(".connector-path");
        paths.forEach(p => {
          const sourceIds = (p.dataset.sourceIds || "").split(",");
          const targetId = p.dataset.targetId;
          const targetEl = document.getElementById("wiki-match-" + targetId) || canvas.querySelector(`[data-match-id="${targetId}"]`);
          const targetHas = targetEl && (targetEl.querySelector(`[data-player-name="${CSS.escape(playerName)}"]`) || targetEl.dataset.playerName === playerName);

          let srcHas = false;
          sourceIds.forEach(sId => {
            const srcEl = document.getElementById("wiki-match-" + sId) || canvas.querySelector(`[data-match-id="${sId}"]`);
            if (srcEl && (srcEl.querySelector(`[data-player-name="${CSS.escape(playerName)}"]`) || srcEl.dataset.playerName === playerName)) {
              srcHas = true;
            }
          });

          if (p.dataset.playerName === playerName && srcHas && targetHas) {
            p.classList.add("highlight");
          } else {
            p.classList.remove("highlight");
          }
        });
      }

      function clearHighlight() {
        activeHighlightPlayer = null;
        const clearBtn = document.getElementById('btnHighlightClear');
        if (clearBtn) {
          clearBtn.disabled = true;
          clearBtn.textContent = '清除高亮';
          clearBtn.setAttribute('aria-label', '清除棋手高亮');
        }
        if (currentViewMode === "draw") {
          clearDrawHighlight();
        } else if (currentViewMode === "wiki") {
          clearWikiHighlight();
        } else {
          clearModernHighlight();
        }
      }

      function clearModernHighlight() {
        canvas.querySelectorAll(".match-card").forEach(c => {
          c.classList.remove("highlight", "dimmed");
        });
        svg.querySelectorAll(".connector-path").forEach(p => {
          p.classList.remove("highlight");
        });
      }

      function clearWikiHighlight() {
        canvas.querySelectorAll(".wiki-player-row, .wiki-r1-player").forEach(r => {
          r.classList.remove("highlight-player", "dimmed-player");
        });
        svg.querySelectorAll(".connector-path").forEach(p => {
          p.classList.remove("highlight");
        });
      }

      // Player Profile Drawer
// Player Profile Drawer（P5.4 提取）：数据状态在 viewer.js，渲染在 viewer-drawer.js；
// 数据经 sources() 适配器实时读取（refreshViewerData 原地刷新后抽屉内容保持最新）。
window.GoViewerDrawer.init({
  sources: () => ({indexList, allData, playerList, playerAliases}),
});
function closePlayerDrawer({restoreFocus = true} = {}) {
  const drawer = document.getElementById('playerDrawer');
  if (!drawer || !drawer.classList.contains('open')) return;
  drawer.classList.remove('open');
  if (!restoringRoute) {
    syncUrl({push: false, player: null});
  }
  if (restoreFocus && lastDrawerTrigger && lastDrawerTrigger.isConnected) {
    lastDrawerTrigger.focus?.();
  }
  lastDrawerTrigger = null;
}
function closeHofModal({restoreFocus = true} = {}) {
  const modal = document.getElementById('hofModal');
  if (!modal || !modal.classList.contains('open')) return;
  modal.classList.remove('open');
  if (restoreFocus && lastHofTrigger && lastHofTrigger.isConnected) {
    lastHofTrigger.focus?.();
  }
  lastHofTrigger = null;
}
window.showPlayer = function(playerNameOrId) {
  const drawer = document.getElementById('playerDrawer');
  const active = document.activeElement;
  if (active && active !== document.body && (!drawer || !drawer.contains(active))) {
    lastDrawerTrigger = active;
  }
  window.GoViewerDrawer.show(playerNameOrId);
  if (drawer?.classList.contains('open') && !applyingDeepLink && !document.getElementById('matchDialog').open) {
    window.GoViewerTable?.rememberPosition?.();
    syncUrl({push: true, player: drawer.dataset.playerId || playerNameOrId});
  }
};

      window.loadAndCloseDrawer = function(edId) {
        closePlayerDrawer({restoreFocus: false});
        return loadEdition(edId, {push: true, clearMatch: true});
      };

      function editionOfMatch(matchId, preferredEditionId) {
        // 先查当前／指定届次：本地按需模式只保留已载入的少数届次，不做整库扫描假设。
        const ordered = [preferredEditionId, currentEditionId].filter(
          (id, index, list) => id && allData[id] && list.indexOf(id) === index);
        for (const editionId of ordered) {
          if (allData[editionId].rounds?.some(round => round.matches?.some(match => match.id === matchId))) {
            return editionId;
          }
        }
        for (const [editionId, data] of Object.entries(allData)) {
          if (data.rounds?.some(round => round.matches?.some(match => match.id === matchId))) return editionId;
        }
        return null;
      }
      function focusMatchInBracket(matchId, preferredEditionId) {
        let editionId = editionOfMatch(matchId, preferredEditionId);
        if (!editionId && preferredEditionId && lazyMode && dataClient && !allData[preferredEditionId]) {
          ensureEditionData(preferredEditionId).then(ok => {
            if (ok) focusMatchInBracket(matchId, preferredEditionId);
          }).catch(() => {});
          return false;
        }
        if (!editionId) return false;
        if (currentEditionId !== editionId) loadEdition(editionId, {push: false});
        const round = allData[editionId].rounds.find(r => r.matches.some(m => m.id === matchId));
        const unplaced = M.roundsForView(allData[editionId]).unclassifiedRounds.some(r => r.matches.some(m => m.id === matchId));
        document.getElementById(M.isPrelimRound(round) ? 'btnScopePrelim' : unplaced ? 'btnScopeUnclassified' : 'btnScopeMain')?.click();
        const data = allData[editionId];
        if (M.isPrelimRound(round)) {
          const ps = resolvePrelimTreeState(data);
          const targetGroup = ps.groups.find(g => g.rounds.some(r => r.matches?.some(m => m.id === matchId)));
          if (targetGroup?.tree && (prelimViewMode !== 'tree' || activePrelimGroupKey !== targetGroup.key)) {
            activePrelimGroupKey = targetGroup.key;
            prelimViewMode = 'tree';
            renderCurrentBracket(data);
            const sum = document.getElementById('boardRoundSummary');
            if (sum) sum.textContent = scopeSummary(data);
            frameCurrentView();
            requestDraw();
          }
        }
        if (M.isTeamCompetition(data) && window.GoViewerTeam.revealMatch(data, matchId)) {
          renderCurrentBracket(data); requestDraw();
        }
        if (window.GoViewerLeague.revealMatch(data, matchId, currentScope)) {
          renderCurrentBracket(data); requestDraw();
        }
        const reveal = () => {
          const element = document.getElementById('draw-match-' + matchId)
            || document.getElementById('wiki-match-' + matchId)
            || document.getElementById('match-' + matchId)
            || document.querySelector(`[data-match-id="${CSS.escape(matchId)}"]`);
          if (!element) return;
          element.scrollIntoView({block: 'center', inline: 'center'});
          element.classList.add('match-located');
          setTimeout(() => element.classList.remove('match-located'), 2400);
        };
        requestAnimationFrame(() => requestAnimationFrame(reveal));
        setTimeout(reveal, 160);
        return true;
      }
      window.GoViewerNavigate = {focusMatch: focusMatchInBracket, loadEdition, currentEdition: () => currentEditionId,
        showMatchDetails, editionOfMatch};

      function mForDetails(id) {
        const data = allData[currentEditionId];
        return M.renderedMatches(data).find(m => m.id === id)
          || (data?.rounds || []).flatMap(r => r.matches || []).find(m => m.id === id);
      }
      function addDetailsButton(table, m, options = {}) {
        if (!m) return;
        const caption = document.createElement('caption');
        caption.className = 'wiki-details-caption';
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'match-details-btn';
        button.textContent = '详情';
        button.onclick = e => {e.stopPropagation(); showMatchDetails(m, options);};
        if(m.draw_group) {
          const group=document.createElement('span');group.className='wiki-draw-group';group.textContent=m.draw_group;
          caption.appendChild(group);
        }
        caption.appendChild(button);
        const quick=document.createElement('span');quick.innerHTML=table.dataset.finalSeries?'':window.GoViewerEditor.quick(m);if(quick.firstChild)caption.appendChild(quick.firstChild);
        table.appendChild(caption);
      }
      function showMatchDetails(m, options = {}) {
        const inPlace = !!options.inPlace;
        const data = allData[currentEditionId];
        const finalRound = data.rounds.find(r => r.matches.some(g => g.id === m.id) && M.isFinalRound(r));
        const games = m.subgames || (!options.singleGame && currentViewMode === 'wiki' && finalRound ? finalRound.matches : [m]);
        const dialog = document.getElementById('matchDialog');
        openMatchContext = {id: m.id, editionId: currentEditionId, singleGame: !!options.singleGame};
        const isSeries = Boolean(m.isSeries || m.series_score);
        // 导入用的 SRC- 来源编号只用于溯源：对话框标题改用“第N局”，没有序号时不显示编号。
        const internalCode = /^SRC-/i.test(m.bracket_code || '');
        const singleTitle = internalCode
          ? (Number.isInteger(options.gameNumber) ? `第${options.gameNumber + 1}局` : '对局详情')
          : `对局 ${m.bracket_code || m.id}`;
        document.getElementById('matchDialogTitle').textContent = isSeries ? `${m.isFinalSeries ? '决赛' : ''}番棋 ${m.series_score}` : (m.isFinalSeries || !options.singleGame && finalRound && currentViewMode === 'wiki' ? '决赛逐局记录' : singleTitle);
        document.getElementById('matchDialogBody').innerHTML = games.map((g, i) => {
          const [a, b] = M.participants(g);
          const outcome = window.GoViewerLeague.outcome(g, a);
          const special = ['draw', 'bye'].includes(outcome.kind);
          const isSeriesSummary = Boolean(isSeries && !m.subgames?.length);
          const heading = isSeriesSummary
            ? `番棋概览（比分 ${esc(m.series_score || '')}）· ${esc(M.dateLabel(g.date))}`
            : `第${i + 1}局 · ${esc(M.dateLabel(g.date))}${M.dateConflictInEdition(g, data) ? ' · 日期待核' : ''}`;
          return `<article class="game-detail"><h4>${heading}</h4>
            <p>${g.black_player_id ? '黑：' : '棋手：'}${a.id ? getFlagSvg(a.nationality) : ''}${esc(a.name_zh || '待定')} ／ ${g.white_player_id ? '白：' : '棋手：'}${b.id ? getFlagSvg(b.nationality) : ''}${esc(b.name_zh || '待定')}</p>
            <p>比赛状态：${esc(special ? outcome.label : M.statusLabel(g))}${M.matchStatus(g)==='no_result'?'（不记录胜者）':''}</p>
            <p>${special ? `赛果：${esc(outcome.label)}` : M.isNoResult(g) ? '赛果：无胜负' : `胜者：${esc(g.winner?.name_zh || '待定')} · ${esc(M.matchResult(g))}`}</p>
            ${g.result_format_status === 'color_conflict' ? '<p class="game-note">赛果文字的执色与胜者记录不一致，待核查。</p>' : ''}
            ${g.result_note ? `<p class="game-note">附注：${esc(g.result_note)}</p>` : ''}
            ${g.moves_count || g.result_type ? `<p>${[g.moves_count ? `手数：${esc(g.moves_count)}` : '', g.result_type ? `结果：${esc(g.result_type)}` : ''].filter(Boolean).join(' · ')}</p>` : ''}
            ${editButton('matches', g.id, '编辑本局记录与赛果')}
            ${window.GoViewerEditor.quick(g)}
            <button class="btn sgf-open-btn" type="button" data-sgf-open="${esc(g.id)}">${g.sgf?.present ? `棋谱 · ${esc(g.sgf.main_line_moves || 0)}手` : '棋谱'}</button>
            <button class="btn" type="button" data-table-locate="${esc(g.id)}" data-table-edition="${esc(data.edition.id)}">在表格中定位</button>
            ${a.id && b.id && a.id !== b.id ? `<a class="btn match-h2h-link" href="head-to-head.html?a=${encodeURIComponent(a.id)}&amp;b=${encodeURIComponent(b.id)}">双方历史交锋</a>` : ''}
            ${!g.black_player_id && !g.white_player_id ? `<p>${g.winner_id ? '执色未知，按记录顺序显示。' : '执色待定。'}</p>` : ''}
            ${g.notes ? `<p class="game-note">${esc(g.notes)}</p>` : ''}
            <div class="game-review" data-review-match="${esc(g.id)}"></div></article>`;
        }).join('');
        const containingRound = data.rounds.find(r => r.matches.some(g => g.id === (m.subgames?.[0]?.id || m.id)));
        if (containingRound?.schedule_note) document.getElementById('matchDialogBody').insertAdjacentHTML('afterbegin', `<p class="game-note">赛程附注：${esc(containingRound.schedule_note)}</p>`);
        if (hasLg29FinalLock(data)) document.getElementById('matchDialogBody').insertAdjacentHTML('afterbegin', '<p class="game-note">用户指定保留：柯洁胜、无胜负、无胜负。决赛已锁定，不纳入后续纠错。</p>');
        document.getElementById('matchDialogBody').querySelectorAll('[data-table-locate]').forEach(button => {
          button.onclick = () => {
            dialog.close();
            window.GoViewerTable?.focusMatch(button.dataset.tableLocate, button.dataset.tableEdition);
          };
        });
        if (inPlace) {
          // 数据刷新后的原地更新：棋谱面板保持当前节点与研究状态，只同步对局摘要与页签文字。
          window.GoViewerSgf?.syncGames?.(games);
        } else {
          if (!options.fromRoute && !applyingDeepLink) window.GoViewerTable?.rememberPosition?.();
          window.GoViewerSgf?.updateMatchDialog(games);
          if (!dialog.open) dialog.showModal();
          dialog.querySelector('.close-btn')?.focus();
          const isSingleRecord = !m.isSeries && !(m.subgames && m.subgames.length > 1)
            && Boolean(data.rounds?.some(r => r.matches?.some(item => item.id === m.id)));
          dialogOpenedMatchUrl = isSingleRecord;
          if (!restoringRoute && !applyingDeepLink && !options.fromRoute && isSingleRecord) {
            syncUrl({push: true, match: m.id, tab: options.tab === 'sgf' ? 'sgf' : null});
          }
          if (options.tab === 'sgf') window.GoViewerSgf?.selectTab?.('sgf');
        }
        dialog.querySelectorAll('[data-review-match]').forEach(element =>
          window.GoViewerReview?.infoInto(element, 'matches', element.dataset.reviewMatch));
      }

      // Search & Autocomplete
      const mobileCatalogMedia = matchMedia('(max-width: 768px)');
      function setMobileCatalog(open) {
        const trigger = document.getElementById('openEditionCatalog');
        const sidebar = document.getElementById('editionCatalog');
        const wasOpen = document.body.classList.contains('catalog-open');
        if (open && !mobileCatalogMedia.matches) return;
        document.body.classList.toggle('catalog-open', open);
        trigger.setAttribute('aria-expanded', String(open));
        document.getElementById('catalogBackdrop').hidden = !open;
        document.querySelector('.app-header').inert = open;
        document.getElementById('mainView').inert = open;
        if (open) {
          sidebar.setAttribute('role', 'dialog');
          sidebar.setAttribute('aria-modal', 'true');
          document.getElementById('closeEditionCatalog').focus();
          sidebar.querySelector('.edition-item.active')?.scrollIntoView({block: 'nearest'});
        } else {
          sidebar.removeAttribute('role');
          sidebar.removeAttribute('aria-modal');
          if (wasOpen && mobileCatalogMedia.matches) trigger.focus();
        }
      }
      function setupEventListeners() {
        document.getElementById('openEditionCatalog').onclick = () => setMobileCatalog(true);
        document.getElementById('closeEditionCatalog').onclick = () => setMobileCatalog(false);
        document.getElementById('catalogBackdrop').onclick = () => setMobileCatalog(false);
        mobileCatalogMedia.addEventListener('change', () => setMobileCatalog(false));
        const more = document.getElementById('workspaceMoreToggle');
        const editionInfo = document.getElementById('toggleEditionInfo');
        more.onclick = () => more.setAttribute('aria-expanded', String(more.getAttribute('aria-expanded') !== 'true'));
        editionInfo.onclick = () => {
          const open = document.body.classList.toggle('mobile-edition-info-open');
          editionInfo.setAttribute('aria-expanded', String(open));
        };
        document.getElementById('workspaceMore').addEventListener('click', event => {
          if (event.target.closest('[data-mode], [data-orient], #btnExportBracket, #btnPrevEd, #btnNextEd, #toggleEditionInfo')) {
            more.setAttribute('aria-expanded', 'false');
            if (mobileCatalogMedia.matches && document.activeElement !== more) more.focus();
          }
        });
        // Scope Switcher: 正赛 / 预选赛
        const scopeGroup = document.getElementById('scopeToggleGroup');
        if (scopeGroup) {
          scopeGroup.addEventListener('click', event => {
            const button = event.target.closest('[data-scope]');
            if (!button || button.dataset.scope === currentScope) return;
            currentScope = button.dataset.scope;
            const data = allData[currentEditionId];
            const meta = indexList.find(x => x.id === currentEditionId) || (boot?.indexItemFromEdition ? boot.indexItemFromEdition(data) : null);
            updateScopeButtons(data);
            if (meta) renderBanner(meta, data);
            renderCurrentBracket(data);
            frameCurrentView();
            if (canvas.dataset.prelimTree === 'true') requestDraw();
            syncUrl({push: true});
            window.dispatchEvent(new CustomEvent('go:scope-changed', {detail: {scope: currentScope}}));
          });
        }

        const editionEditControls = document.getElementById('editionEditControls');
        if (editionEditControls) {
          editionEditControls.addEventListener('click', event => {
            if (event.target.closest('#btnBatchEditCurrentEdition')) {
              window.GoViewerBatchEditor?.open({ edition_id: currentEditionId });
            }
          });
        }

        // View & Orientation Switchers
        const btnModern = document.getElementById("btnViewModern");
        const btnWiki = document.getElementById("btnViewWiki");
        const btnDraw = document.getElementById("btnViewDraw");
        if (btnModern && btnWiki) {
          btnModern.onclick = () => setViewMode("modern");
          btnWiki.onclick = () => setViewMode("wiki");
        }
        if (btnDraw) btnDraw.onclick = () => setViewMode("draw");
        const btnHoriz = document.getElementById("btnOrientHorizontal");
        const btnVert = document.getElementById("btnOrientVertical");
        if (btnHoriz && btnVert) {
          btnHoriz.onclick = () => applyOrientation("horizontal", {persist: true, push: true});
          btnVert.onclick = () => applyOrientation("vertical", {persist: true, push: true});
        }

        function setViewMode(mode) {
          applyViewMode(mode, {persist: true, push: true});
        }

        // 外观主题：委托 GoViewerTheme 统一管理 light/dark/auto、系统跟随与跨页持久化。
        if (themeManager) {
          const initialTheme = themeManager.init({fallback: legacyThemeFallback, persistIfMissing: true});
          themePreference = initialTheme.preference;
          currentTheme = initialTheme.effective;
          window.addEventListener('go:theme-changed', event => {
            if (!event.detail) return;
            themePreference = event.detail.preference;
            currentTheme = event.detail.effective;
          });
        } else {
          const resolveTheme = preference => preference !== 'auto' ? preference
            : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
          const applyTheme = (preference, persist) => {
            themePreference = preference;
            currentTheme = resolveTheme(preference);
            document.body.dataset.theme = currentTheme;
            document.body.dataset.themePref = preference;
            document.documentElement.dataset.themePref = preference;
            document.body.style.colorScheme = currentTheme;
            document.querySelectorAll('[data-theme-option]').forEach(button => {
              const active = button.dataset.themeOption === preference;
              button.classList.toggle('active', active);
              button.setAttribute('aria-pressed', String(active));
            });
            if (persist) { try { localStorage.setItem(THEME_KEY, preference); } catch (_) {} }
          };
          if (window.matchMedia) {
            const scheme = window.matchMedia('(prefers-color-scheme: dark)');
            const onChange = () => { if (themePreference === 'auto') applyTheme('auto', false); };
            if (scheme.addEventListener) scheme.addEventListener('change', onChange);
            else if (scheme.addListener) scheme.addListener(onChange);
          }
          document.querySelectorAll('[data-theme-option]').forEach(button => {
            button.onclick = () => applyTheme(button.dataset.themeOption, true);
          });
          applyTheme(themePreference, false);
        }

        // 全局导航下拉：移动端可见入口，不依赖悬停。
        const navToggle = document.getElementById('btnNavToggle');
        const globalNav = document.getElementById('globalNav');
        if (navToggle && globalNav) {
          navToggle.onclick = () => {
            const open = document.body.classList.toggle('nav-open');
            navToggle.setAttribute('aria-expanded', String(open));
          };
          globalNav.addEventListener('click', event => {
            if (event.target.closest('.nav-link') && window.matchMedia('(max-width: 900px)').matches) {
              document.body.classList.remove('nav-open');
              navToggle.setAttribute('aria-expanded', 'false');
            }
          });
        }
        document.getElementById('btnNavTournaments')?.addEventListener('click', () => {
          document.body.classList.remove('nav-open');
          document.getElementById('btnNavToggle')?.setAttribute('aria-expanded', 'false');
        });
        document.getElementById('crumbHome')?.addEventListener('click', () => {
          catalog?.openHome?.();
          const list = document.getElementById('editionList');
          if (list) list.scrollTop = 0;
        });
        document.getElementById('currentTournamentLabel')?.addEventListener('click', () => {
          if (window.GoViewerEditor?.enabled?.()) return;
          const tid = allData[currentEditionId]?.tournament?.id || currentTournamentId;
          if (tid) catalog?.openTournament?.(tid, currentEditionId);
        });

        // Wheel Event Isolation: prevents coupled scrolling between list and viewport
        viewport.addEventListener("wheel", (e) => {
          e.stopPropagation();
        }, { passive: true });

        const editionList = document.getElementById("editionList");
        if (editionList) {
          editionList.addEventListener("wheel", (e) => {
            e.stopPropagation();
          }, { passive: true });
        }

        // Navigation follows the selected list.
        document.getElementById('btnEditionRoster').onclick=()=>{document.getElementById('rosterSearch').value='';renderRoster();document.getElementById('rosterDialog').showModal();};
        document.getElementById('rosterSearch').oninput=renderRoster;
        const rosterCreate=document.getElementById('rosterCreatePlayer');
        if(rosterCreate)rosterCreate.onclick=()=>window.GoViewerEditor?.openCreatePlayer({onCreated:async player=>{
          try{
            const meta=window.GoViewerEditor.metadata();
            const response=await fetch('/api/entry/submit',{method:'POST',headers:{'Content-Type':'application/json','X-Editor-Token':meta.token,'X-Viewer-Compact':'players-v1'},body:JSON.stringify({payload:{mode:'existing_edition',edition_id:currentEditionId,participants:[player.id],rounds:[]}})});
            const result=await response.json();
            if(!response.ok)throw new Error(result.error||'加入本届名单失败。');
            if(result.snapshot)window.refreshViewerData(result.snapshot);
            document.getElementById('rosterSearch').value='';
            renderRoster();
            document.getElementById('rosterDialog').close();
            window.showPlayer(player.id);
          }catch(error){document.getElementById('editModeStatus').textContent=error.message;}
        }});
        document.getElementById('btnPrevEd').onclick = () => navigateEdition(-1);
        document.getElementById('btnNextEd').onclick = () => navigateEdition(1);
        async function navigateEdition(step) {
          const list = orderedTournamentEditionsAsc();
          const i = list.findIndex(e => e.id === currentEditionId);
          const target = list[i + step];
          if (target && await loadEdition(target.id, {push: true, clearMatch: true})) {
            document.querySelector(`#editionList .edition-item[data-id="${CSS.escape(target.id)}"]`)?.scrollIntoView({block: 'center', inline: 'center'});
          }
        }

        // Search Input: totals, keyboard selection, direct match location and table hand-off.
        const searchInput = document.getElementById("searchInput");
        const searchDropdown = document.getElementById("searchDropdown");
        let searchResults = [], searchActive = -1;
        const normalizeQuery = value => String(value || '').trim().toLowerCase()
          .replace(/李世石/g, '李世乭').replace(/彭立尧/g, '彭立峣').replace(/陈时映/g, '陈时暎');
        function hideSearch() {
          searchDropdown.style.display = 'none';
          searchDropdown.innerHTML = '';
          searchInput.setAttribute('aria-expanded', 'false');
          searchActive = -1; searchResults = [];
        }
        function setActiveSearch(index) {
          if (!searchResults.length) { searchActive = -1; return; }
          searchActive = (index + searchResults.length) % searchResults.length;
          searchDropdown.querySelectorAll('.search-item').forEach((el, i) => el.classList.toggle('active', i === searchActive));
          searchDropdown.querySelectorAll('.search-item')[searchActive]?.scrollIntoView({block: 'nearest'});
        }
        function activateSearch(index) {
          const item = searchResults[index];
          if (!item) return;
          hideSearch();
          item.action();
        }
        let headerSearchToken = 0;
        let headerSearchTimer = 0;
        function renderSearchMenu(raw, matchedPlayers, matchedEditions, matchedMatches, totalMatchesText) {
          searchResults = [];
          const item = (html, action) => {
            const index = searchResults.length;
            searchResults.push({action});
            return `<div class="search-item" role="option" data-search-index="${index}">${html}</div>`;
          };
          let html = `<div class="search-summary">棋手 ${matchedPlayers.length} 位 · 届次 ${matchedEditions.length} 届 · 对局 ${totalMatchesText} 局</div>`;
          if (matchedPlayers.length) {
            html += '<div class="search-group">棋手搜索</div>';
            matchedPlayers.slice(0, 8).forEach(p => {
              const titles = (rankingList.find(r => r.id === p.id)?.titles) || 0;
              html += item(`<div><span class="search-name">${getFlagSvg(p.nationality)}${esc(p.name_zh)}</span>
                <span class="search-side">${esc(p.default_kiin || '—')}</span>
                ${p.name_native ? `<div class="profile-name-note">${esc(p.name_native)}</div>` : ''}</div>
                <span class="search-tag">${titles} 次冠军</span>`,
                () => window.showPlayer(p.id));
            });
          }
          if (matchedEditions.length) {
            html += '<div class="search-group">赛事届次</div>';
            matchedEditions.slice(0, 6).forEach(ed => {
              html += item(`<div><span class="search-name">${esc(ed.tournament_short)} ${M.editionLabel(ed)}</span>
                <span class="search-side">${ed.year ? ed.year + '年' : ''}</span></div>
                <span class="search-tag">${esc(ed.champion || '—')}${ed.finals_score ? ` (${esc(ed.finals_score)})` : ''}</span>`,
                () => window.GoViewerEditor?.enabled() ? window.GoViewerEditor.open('editions', ed.id) : loadEdition(ed.id, {push: true, clearMatch: true, openTournament: true}));
            });
          }
          if (matchedMatches.length) {
            html += '<div class="search-group">对局</div>';
            matchedMatches.slice(0, 6).forEach(entry => {
              const [a, b] = M.participants(entry.match);
              html += item(`<div><span class="search-name">${esc(entry.edition.tournament_short)} ${M.editionLabel(entry.edition)} · ${esc(entry.round.round_name)} · ${esc(entry.match.bracket_code || '第' + entry.match.match_number + '局')}</span>
                <div class="profile-name-note">${esc(a.name_zh || '待定')} / ${esc(b.name_zh || '待定')} · ${esc(M.matchResult(entry.match))}</div></div>
                <span class="search-tag">${window.GoViewerEditor?.enabled() ? '编辑对局' : '在表格定位'}</span>`,
                () => window.GoViewerEditor?.enabled() ? window.GoViewerEditor.open('matches', entry.match.id) : window.GoViewerTable?.focusMatch(entry.match.id, entry.edition.id));
            });
          }
          if (matchedPlayers.length || matchedEditions.length || matchedMatches.length) {
            html += item(`<span class="search-all">在表格中查看全部结果</span><span class="search-tag">→</span>`,
              () => window.GoViewerTable?.openQuery(raw.trim()));
          } else {
            html += '<div class="search-empty">未找到匹配棋手、赛事或对局</div>';
          }
          searchDropdown.innerHTML = html;
          searchDropdown.style.display = 'block';
          searchDropdown.setAttribute('role', 'listbox');
          searchInput.setAttribute('aria-expanded', 'true');
          searchActive = -1;
        }
        function runSearch(raw) {
          clearTimeout(headerSearchTimer);
          const token = ++headerSearchToken;
          const query = normalizeQuery(raw);
          if (!query) { hideSearch(); return; }
          const matchedPlayers = playerList.filter(p => M.matchesPlayerQuery(p, query, playerAliases));
          const matchedEditions = indexList.filter(item =>
            (item.tournament_short.toLowerCase().replace(/杯/g, '') + (item.edition_number ?? '')).includes(query.replace(/\s|杯/g, '')) ||
            item.tournament_name.toLowerCase().includes(query) ||
            item.tournament_short.toLowerCase().includes(query) ||
            item.champion.toLowerCase().includes(query) ||
            item.runner_up.toLowerCase().includes(query) ||
            String(item.year).includes(query) ||
            `${M.editionLabel(item)}`.includes(query));
          const matchedMatches = [], seen = new Set();
          outer: for (const item of indexList) {
            const data = allData[item.id];
            if (!data) continue;
            for (const round of data.rounds) for (const match of round.matches) {
              const text = (String(match.bracket_code || '') + ' ' + match.id).toLowerCase();
              const hit = text.includes(query) || M.participants(match).some(p => p?.id && M.matchesPlayerQuery(p, query, playerAliases));
              if (!hit || seen.has(match.id)) continue;
              seen.add(match.id);
              matchedMatches.push({edition: item, round, match});
              if (matchedMatches.length >= 200) break outer;
            }
          }
          const localTotal = `${matchedMatches.length}${matchedMatches.length >= 200 ? '+' : ''}`;
          renderSearchMenu(raw, matchedPlayers, matchedEditions, matchedMatches, localTotal);
          if (lazyMode && dataClient && (dataClient.search || dataClient.catalogSearch)) {
            headerSearchTimer = setTimeout(async () => {
              try {
                const term = raw.trim();
                const [catRes, matchRes] = await Promise.allSettled([
                  dataClient.catalogSearch ? dataClient.catalogSearch(term, 6) : Promise.resolve(null),
                  dataClient.search ? dataClient.search({q: term, page: 1, page_size: 8, sort: 'date_desc'}) : Promise.resolve(null),
                ]);
                if (token !== headerSearchToken || searchDropdown.style.display === 'none' || normalizeQuery(searchInput.value) !== query) return;
                const serverEditions = (catRes.status === 'fulfilled' && (catRes.value?.editions || catRes.value?.items)) || [];
                const seenEd = new Set(serverEditions.map(e => e.id));
                const mergedEditions = [...serverEditions, ...matchedEditions.filter(e => !seenEd.has(e.id))];
                const payload = matchRes.status === 'fulfilled' ? matchRes.value : null;
                const serverMatches = ((payload && payload.items) || []).map(item => {
                  const edMeta = indexList.find(e => e.id === item.edition_id) || {
                    id: item.edition_id, tournament_id: item.tournament_id,
                    tournament_short: item.tournament_short || '', tournament_name: item.tournament_name || '',
                    edition_number: item.edition_number, year: item.year,
                  };
                  return {
                    edition: edMeta,
                    round: {id: item.round_id, round_name: item.round_name || '', round_order: item.round_order || 0},
                    match: item,
                  };
                });
                const total = payload && payload.page && typeof payload.page.total === 'number'
                  ? payload.page.total.toLocaleString('zh-CN')
                  : String(serverMatches.length);
                renderSearchMenu(raw, matchedPlayers, mergedEditions, serverMatches.length ? serverMatches : matchedMatches, total);
              } catch (_) { /* 保持本地已呈现结果 */ }
            }, 80);
          }
        }
        searchInput.addEventListener('input', event => runSearch(event.target.value));
        searchInput.addEventListener('keydown', event => {
          if (searchDropdown.style.display === 'none' || !searchResults.length) return;
          if (event.key === 'ArrowDown') { event.preventDefault(); setActiveSearch(searchActive + 1); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveSearch(searchActive - 1); }
          else if (event.key === 'Enter' && searchActive >= 0) { event.preventDefault(); activateSearch(searchActive); }
          else if (event.key === 'Escape') { event.preventDefault(); hideSearch(); }
        });
        searchDropdown.addEventListener('click', event => {
          const item = event.target.closest('[data-search-index]');
          if (item) activateSearch(Number(item.dataset.searchIndex));
        });
        document.addEventListener("click", (e) => {
          if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) hideSearch();
        });

        window.loadAndCloseSearch = function(edId) {
          hideSearch();
          searchInput.value = "";
          loadEdition(edId, {push: true, clearMatch: true});
        };

        // Drawer Close
        document.getElementById("closeDrawerBtn").onclick = () => {
          closePlayerDrawer({restoreFocus: true});
        };

        // Hall of Fame
        const hofModal = document.getElementById("hofModal");
        document.getElementById("btnHof").onclick = () => {
          lastHofTrigger = document.activeElement || document.getElementById("btnHof");
          renderHofGrid();
          hofModal.classList.add("open");
          document.getElementById("closeHofBtn")?.focus();
        };
        document.getElementById("closeHofBtn").onclick = () => {
          closeHofModal({restoreFocus: true});
        };
        hofModal.onclick = (e) => {
          if (e.target === hofModal) closeHofModal({restoreFocus: true});
        };

        // Clear Highlight
        document.getElementById("btnHighlightClear").onclick = clearHighlight;

        // Compact Banner Toggle (FE-3 & UX-2 persistence)
        const BANNER_COMPACT_KEY = 'go_banner_compact_v1';
        const compactBannerBtn = document.getElementById('toggleBannerCompactBtn');
        const bannerEl = document.querySelector('.banner');
        if (compactBannerBtn && bannerEl) {
          const applyCompactBanner = (compact, persist) => {
            bannerEl.classList.toggle('banner--compact', Boolean(compact));
            compactBannerBtn.setAttribute('aria-pressed', String(Boolean(compact)));
            compactBannerBtn.textContent = compact ? '展开横幅' : '收起横幅';
            if (persist) {
              try { localStorage.setItem(BANNER_COMPACT_KEY, compact ? '1' : '0'); } catch (_) {}
            }
          };
          try {
            const storedCompact = localStorage.getItem(BANNER_COMPACT_KEY);
            if (storedCompact === '1' || (storedCompact === null && window.innerHeight <= 820)) {
              applyCompactBanner(true, false);
            }
          } catch (_) {}
          compactBannerBtn.onclick = () => {
            const compact = !bannerEl.classList.contains('banner--compact');
            applyCompactBanner(compact, true);
            frameCurrentView();
            requestDraw();
          };
        }

        // Window resize & dynamic layout/numbering redraw connectors
        window.addEventListener('resize', requestDraw);
        window.addEventListener('go:numbering-decorated', requestDraw);
        window.addEventListener('go:edit-mode-changed', requestDraw);
        document.fonts?.ready?.then(() => {
          if (allData[currentEditionId]) requestDraw();
        });
        document.getElementById('matchDialog').addEventListener('close', () => {
          // A queued close event must not reset a dialog that was reopened immediately.
          if (!document.getElementById('matchDialog').open) {
            openMatchContext = null;
            window.GoViewerSgf?.reset();
            if (!restoringRoute && dialogOpenedMatchUrl) {
              dialogOpenedMatchUrl = false;
              syncUrl({push: false, match: null, tab: null});
            }
          }
        });
        window.addEventListener('keydown', e => {
          if (e.key === 'Escape') {
            if (document.body.classList.contains('catalog-open')) { setMobileCatalog(false); return; }
            if (mobileCatalogMedia.matches && more.getAttribute('aria-expanded') === 'true') {
              more.setAttribute('aria-expanded', 'false'); more.focus(); return;
            }
            closePlayerDrawer({restoreFocus: true});
            closeHofModal({restoreFocus: true});
            document.getElementById('matchDialog').close();
            searchDropdown.style.display = 'none';
            clearHighlight();
          }
        });
      }

      function renderHofGrid() {
        const grid = document.getElementById("hofGrid");
        grid.innerHTML = rankingList.map((p, idx) => `
          <div class="ranking-card" role="button" tabindex="0" data-hof-player="${esc(p.id)}">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="rank-num rank-num-${idx+1}">${idx+1}</span>
              <div>
                <div style="font-weight: 700; font-size: 14px; color: var(--text-main);">${getFlagSvg(p.nationality)}${esc(p.name)}</div>
                <div style="font-size: 10px; color: var(--text-muted);">${esc(p.kiin)}</div>
              </div>
            </div>
            <div style="font-size: 16px; font-weight: 800; color: var(--accent-gold);">
              ${p.titles} <span style="font-size: 10px; font-weight: normal; color: var(--text-muted);">冠</span>
            </div>
          </div>
        `).join('');
        grid.querySelectorAll('[data-hof-player]').forEach(card => {
          const openFromCard = () => {
            const pid = card.dataset.hofPlayer;
            closeHofModal({restoreFocus: false});
            window.showPlayer(pid);
            lastDrawerTrigger = document.getElementById('btnHof');
          };
          card.onclick = openFromCard;
          card.onkeydown = (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openFromCard();
            }
          };
        });
      }

      // Pan & Zoom Implementation
      function setupSegmentedControls() {
        const groups = [...document.querySelectorAll('[data-segmented]')];
        const sync = () => groups.forEach(group => {
          const active = group.querySelector('.view-toggle-btn.active');
          if (!active || group.hidden) return;
          group.style.setProperty('--segment-x', `${active.offsetLeft}px`);
          group.style.setProperty('--segment-width', `${active.offsetWidth}px`);
        });
        const observer = new MutationObserver(sync);
        groups.forEach(group => observer.observe(group, {subtree: true, attributes: true, attributeFilter: ['class', 'hidden']}));
        if (window.ResizeObserver) {
          const resize = new ResizeObserver(sync);
          groups.forEach(group => resize.observe(group));
        }
        window.addEventListener('resize', sync);
        requestAnimationFrame(sync);
      }

      function setupPanZoom() {
        let zoomTimer;
        const scrollHome = () => viewport.scrollTo({left: 0, top: 0,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
        const transitionZoom = () => {
          canvas.classList.add('is-zoom-transitioning');
          clearTimeout(zoomTimer);
          zoomTimer = setTimeout(() => { canvas.classList.remove('is-zoom-transitioning'); requestDraw(); }, 220);
        };
        document.getElementById('btnFitView').onclick = () => {
          const fit = Math.min((viewport.clientWidth - 40) / canvas.scrollWidth, (viewport.clientHeight - 40) / canvas.scrollHeight, 1);
          setZoom(fit); scrollHome();
        };
        document.getElementById("btnZoomIn").onclick = () => setZoom(zoomLevel + 0.1);
        document.getElementById("btnZoomOut").onclick = () => setZoom(zoomLevel - 0.1);
        document.getElementById("btnResetZoom").onclick = () => {
          setZoom(1); scrollHome();
        };

        function setZoom(newZoom) {
          transitionZoom();
          zoomLevel = Math.min(Math.max(0.12, newZoom), 2.0);
          canvas.style.zoom = String(zoomLevel);
          document.getElementById("btnResetZoom").textContent = Math.round(zoomLevel * 100) + "%";
          requestDraw();
        }

        viewport.addEventListener('wheel', event => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          const rect = viewport.getBoundingClientRect();
          const anchorX = (event.clientX - rect.left + viewport.scrollLeft) / zoomLevel;
          const anchorY = (event.clientY - rect.top + viewport.scrollTop) / zoomLevel;
          const next = zoomLevel * Math.exp(-event.deltaY * 0.002);
          setZoom(next);
          viewport.scrollLeft = anchorX * zoomLevel - (event.clientX - rect.left);
          viewport.scrollTop = anchorY * zoomLevel - (event.clientY - rect.top);
        }, {passive: false});

        viewport.addEventListener("mousedown", (e) => {
          if (e.target.closest(".match-card, table, button")) return;
          isPanning = true;
          startX = e.pageX - viewport.offsetLeft;
          startY = e.pageY - viewport.offsetTop;
          scrollLeft = viewport.scrollLeft;
          scrollTop = viewport.scrollTop;
        });

        viewport.addEventListener("mouseleave", () => isPanning = false);
        viewport.addEventListener("mouseup", () => isPanning = false);

        viewport.addEventListener("mousemove", (e) => {
          if (!isPanning) return;
          e.preventDefault();
          const x = e.pageX - viewport.offsetLeft;
          const y = e.pageY - viewport.offsetTop;
          viewport.scrollLeft = scrollLeft - (x - startX);
          viewport.scrollTop = scrollTop - (y - startY);
        });

        let pinchStartDist = 0;
        let pinchStartZoom = 1;
        viewport.addEventListener('touchstart', event => {
          if (event.touches.length === 2) {
            const dx = event.touches[0].clientX - event.touches[1].clientX;
            const dy = event.touches[0].clientY - event.touches[1].clientY;
            pinchStartDist = Math.hypot(dx, dy);
            pinchStartZoom = zoomLevel;
          }
        }, {passive: true});
        viewport.addEventListener('touchmove', event => {
          if (event.touches.length === 2 && pinchStartDist > 10) {
            event.preventDefault();
            const dx = event.touches[0].clientX - event.touches[1].clientX;
            const dy = event.touches[0].clientY - event.touches[1].clientY;
            const dist = Math.hypot(dx, dy);
            setZoom(pinchStartZoom * (dist / pinchStartDist));
          }
        }, {passive: false});
        viewport.addEventListener('touchend', () => {
          pinchStartDist = 0;
        }, {passive: true});
      }

      window.getBracketExportContext = function() {
        const data = allData[currentEditionId], meta = indexList.find(e => e.id === currentEditionId);
        if (!data || !meta) return null;
        let champion = data.team_competition?.champion?.name_zh || data.champion?.name_zh || (M.editionOngoing(meta) ? '待定' : '—');
        let runner = data.team_competition?.runner_up?.name_zh || data.runner_up?.name_zh || (M.editionOngoing(meta) ? '待定' : '—');
        let score = data.edition.finals_score || (M.editionOngoing(meta) ? '待定' : '—');
        let scoreLabel = data.team_competition && data.edition.edition_number != null && data.edition.edition_number < 3 ? '团体总局分' : '决赛总比分';
        if (data.tournament?.id === 'nongshim' && window.GoViewerTeam?.nongshimModel) {
          const ns = window.GoViewerTeam.nongshimModel(data);
          const formatTeam = entry => entry ? `${entry.team.name_zh}（${entry.wins}胜${entry.losses}负）` : '';
          const first = ns.teams.find(t => t.team.finish_rank === 1);
          const second = ns.teams.find(t => t.team.finish_rank === 2);
          const third = ns.teams.find(t => t.team.finish_rank === 3);
          if (first) champion = formatTeam(first);
          if (second) runner = formatTeam(second);
          scoreLabel = '季军';
          score = third ? formatTeam(third) : (M.editionOngoing(meta) ? '待定' : '—');
        }
        return {mode: currentViewMode, orientation: currentOrientation, zoom: zoomLevel, year: meta.year, shortName: meta.tournament_short, editionNumber: meta.edition_number,
          title: M.editionTitle(data.edition, meta),
          champion,
          runner,
          score,
          scoreLabel,
          period: data.edition.start_date
            ? (data.edition.end_date ? `${data.edition.start_date} ～ ${data.edition.end_date}` : data.edition.start_date)
            : String(meta.year || '—'),
          rules: [data.edition.rules, data.edition.komi, data.edition.time_limit].filter(Boolean).join(' · '),
          notice: document.getElementById('viewerNotice').textContent,
          editionId: currentEditionId,
          // 导出时按全部循环圈分组纵向排列；范围与当前赛段一致。
          league: (() => {
            if (!window.GoViewerLeague) return null;
            const rounds = currentScope === 'prelim'
              ? (data.rounds || []).filter(M.isPrelimRound)
              : M.roundsForView(data).mainRounds;
            const groups = window.GoViewerLeague.partition(data, rounds).groups;
            return groups.length ? {data, groups, scope: currentScope} : null;
          })()};
      };
      window.prepareBracketExport = function() {
        canvas.querySelectorAll('.is-player-active').forEach(el => el.classList.remove('is-player-active'));
        fitPlayerNames();
        if (currentViewMode === 'wiki') centerWikiMatches();
        drawConnectors();
      };

      window.refreshViewerData = function(snapshot) {
        snapshot = M.hydrateSnapshot(snapshot);
        const viewState={zoom:zoomLevel,left:viewport.scrollLeft,top:viewport.scrollTop,list:document.getElementById('editionList').scrollTop};
        const searchValue=document.getElementById('searchInput').value;
        const drawer = document.getElementById('playerDrawer');
        const openPlayer = drawer.classList.contains('open') ? drawer.dataset.playerId : null;
        // 保存等刷新不再无故关闭对局详情：记录打开状态，稍后原地更新内容。
        const matchDialog = document.getElementById('matchDialog');
        const dialogWasOpen = !!(matchDialog.open && openMatchContext);
        const dialogScroll = dialogWasOpen ? (document.getElementById('matchDialogBody')?.scrollTop || 0) : 0;
        if (Array.isArray(snapshot.index)) {
          indexList.splice(0, indexList.length, ...snapshot.index);
          if (boot && boot.indexById) {
            boot.indexById.clear();
            for (const item of indexList) if (item && item.id) boot.indexById.set(item.id, item);
          }
        }
        if (Array.isArray(snapshot.ranking)) {
          rankingList.splice(0, rankingList.length, ...snapshot.ranking);
        }
        if (!snapshot.partial) {
          for (const key of Object.keys(allData)) delete allData[key];
          dataClient?.invalidateAllEditions?.();
        }
        // 删除届次时，增量快照只带回仍存在的届次；被删届次需从缓存移除。
        for (const removed of snapshot.deleted_editions || []) {
          delete allData[removed];
          dataClient?.invalidateEdition?.(removed);
        }
        Object.assign(allData, snapshot.editions);
        if (dataClient?.rememberEdition) {
          for (const [edKey, edVal] of Object.entries(snapshot.editions || {})) {
            dataClient.rememberEdition(edKey, edVal);
          }
        }
        if (snapshot.players) {
          if (Array.isArray(window.PLAYERS_DATA)) {
            window.PLAYERS_DATA.splice(0, window.PLAYERS_DATA.length, ...snapshot.players);
          } else {
            window.PLAYERS_DATA = snapshot.players;
          }
        }
        if (snapshot.playerAliases) {
          window.PLAYER_ID_ALIASES = window.PLAYER_ID_ALIASES || {};
          window.PLAYER_NAME_ALIASES = window.PLAYER_NAME_ALIASES || {};
          for (const k of Object.keys(window.PLAYER_ID_ALIASES)) delete window.PLAYER_ID_ALIASES[k];
          for (const k of Object.keys(window.PLAYER_NAME_ALIASES)) delete window.PLAYER_NAME_ALIASES[k];
          Object.assign(window.PLAYER_ID_ALIASES, snapshot.playerAliases.ids || {});
          Object.assign(window.PLAYER_NAME_ALIASES, snapshot.playerAliases.names || {});
          playerAliases = {ids: window.PLAYER_ID_ALIASES, names: window.PLAYER_NAME_ALIASES};
        }
        if (snapshot.players || !snapshot.partial) {
          const playersDir = snapshot.players || window.PLAYERS_DATA || [];
          playerList.splice(0, playerList.length, ...M.collectPlayers(allData, playersDir));
        }
        if (!dialogWasOpen) matchDialog.close();
        document.getElementById('searchDropdown').style.display = 'none';
        dataClient?.invalidateCatalog?.();
        // A table view keeps its filters; the bracket still re-renders underneath.
        window.__goViewerRefreshing=true;
        try { loadEdition(currentEditionId, {push: false, skipCatalogSwitch: true}); } finally { window.__goViewerRefreshing=false; }
        catalog?.invalidate?.();
        document.getElementById('searchInput').value=searchValue;
        zoomLevel=viewState.zoom;canvas.style.zoom=String(zoomLevel);document.getElementById('btnResetZoom').textContent=Math.round(zoomLevel*100)+'%';
        viewport.scrollLeft=viewState.left;viewport.scrollTop=viewState.top;document.getElementById('editionList').scrollTop=viewState.list;requestDraw();
        window.GoViewerTable?.refresh();
        if (dialogWasOpen) {
          const editionData = allData[openMatchContext.editionId];
          const singleGame = openMatchContext.singleGame;
          const refreshed = editionData ? (singleGame ? editionData.rounds.flatMap(r => r.matches) : M.renderedMatches(editionData)).find(m => m.id === openMatchContext.id) : null;
          if (refreshed) {
            showMatchDetails(singleGame ? M.singleGamePresentation(refreshed) : refreshed, {inPlace: true, singleGame});
            const dialogBody = document.getElementById('matchDialogBody');
            if (dialogBody) dialogBody.scrollTop = dialogScroll;
          } else {
            openMatchContext = null;
            matchDialog.close();
          }
        }
        if(document.getElementById('rosterDialog').open)renderRoster();
        if (openPlayer) window.showPlayer(openPlayer);
        if (document.getElementById('hofModal').classList.contains('open')) renderHofGrid();
      };

      // 供对局表格等模块读取当前赛段范围（正赛/预选赛）
      window.GoViewerScope = {get current() { return currentScope; }};

      // Start on DOM ready
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
      } else {
        init();
      }
    })();
