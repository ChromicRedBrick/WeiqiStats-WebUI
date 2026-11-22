/* 阶段 E：命令菜单、可调整赛事目录侧栏、快捷键登记与轻量过渡。
   命令菜单只是既有可见入口的补充；所有数据修改仍走原有编辑、校验与确认流程。 */
(function () {
  const M = window.GoViewerModel;
  if (!M) return;
  const E = M.escape;
  const indexList = window.TOURNAMENTS_INDEX || [];
  const allData = window.ALL_TOURNAMENTS_DATA || {};
  const playerDirectory = window.PLAYERS_DATA || [];
  const aliases = {ids: window.PLAYER_ID_ALIASES || {}, names: window.PLAYER_NAME_ALIASES || {}};
  const flags = window.GoViewerFlags || {html: () => '', info: () => ({name: ''})};
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');
  const shortcutLabel = isMac ? '⌘K' : 'Ctrl K';
  const SIDEBAR_KEY = 'go_sidebar_width_v1';
  const SIDEBAR_MIN = 13;
  const SIDEBAR_MAX = 26;

  const root = document.documentElement;
  const remSize = () => parseFloat(getComputedStyle(root).fontSize) || 16;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase();
  const text = value => E(value ?? '');

  function svg(name) {
    const paths = {
      person: '<circle cx="12" cy="8" r="3.2" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 20c.6-3.4 3.2-5.2 6.5-5.2s5.9 1.8 6.5 5.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      review: '<rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="m8 12 2.4 2.4L16 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
      history: '<path d="M4 11a8 8 0 1 1 2.6 5.9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4 5v6h6M12 8v5l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
      trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6H5v2a4 4 0 0 0 4 4M16 6h3v2a4 4 0 0 1-4 4M12 13v4M9 20h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      users: '<circle cx="9" cy="8" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M3.8 19c.5-2.9 2.7-4.5 5.2-4.5s4.7 1.6 5.2 4.5M16 6.2a2.6 2.6 0 0 1 0 5M17 14.6c2 .3 3.4 1.7 3.8 4.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      table: '<rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M4 10h16M10 10v9" stroke="currentColor" stroke-width="1.6"/>',
      bracket: '<path d="M4 6h5v4H4zM4 14h5v4H4zM15 10h5v4h-5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 8h3v6h3M9 16h3v-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      sun: '<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.6"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      moon: '<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.2 8.2 0 1 0 20 14.2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
      monitor: '<rect x="3.5" y="4.5" width="17" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M9 20h6M12 16.5V20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      download: '<path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
      play: '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6"/><path d="m10 8.8 5 3.2-5 3.2V8.8Z" fill="currentColor"/>',
      calendar: '<rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M4 10h16M8 3.5V7M16 3.5V7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      edit: '<path d="m5 19 3.5-.7L19 7.8 16.2 5 5.7 15.5 5 19Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m14.5 6.7 2.8 2.8" stroke="currentColor" stroke-width="1.6"/>',
      eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.8" stroke="currentColor" stroke-width="1.6"/>',
      arrow: '<path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
  }

  /* ---------------------------------------------------------
     快捷键登记：统一解析、冲突提示与输入/弹窗边界。
     说明：命令菜单需要可在搜索框中打开，因此 mod+k 被登记为全局快捷键；
     其他快捷键若只在棋盘内生效，应自行跳过 input/textarea。
     --------------------------------------------------------- */
  const shortcuts = new Map();
  function comboOf(event) {
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('mod');
    if (event.altKey) parts.push('alt');
    if (event.shiftKey) parts.push('shift');
    parts.push(String(event.key || '').toLowerCase());
    return parts.join('+');
  }
  function registerShortcut(combo, handler, options = {}) {
    const key = String(combo).toLowerCase();
    if (shortcuts.has(key)) {
      console.warn(`快捷键 ${key} 已登记，后登记的处理器不会覆盖前一个。`);
      return false;
    }
    shortcuts.set(key, {handler, description: options.description || '', dialogId: options.dialogId || ''});
    return true;
  }
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing) return;
    const entry = shortcuts.get(comboOf(event));
    if (!entry) return;
    const openDialogs = [...document.querySelectorAll('dialog[open]')];
    // 命令菜单可在自身打开时重复聚焦；其他模态弹窗/遮罩内不抢占快捷键。
    if (openDialogs.some(dialog => dialog.id !== entry.dialogId) || document.querySelector('.modal-overlay.open')) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) entry.handler(event);
  }, true);

  window.GoViewerShortcuts = {
    register: registerShortcut,
    list: () => [...shortcuts.entries()].map(([combo, entry]) => ({combo, description: entry.description}))
  };

  /* ---------------------------------------------------------
     可调整侧栏：桌面拖动 / 键盘调整 / 双击复位；只改变侧栏宽度，
     不覆盖棋盘，也不改变棋盘交叉点的命中坐标。
     --------------------------------------------------------- */
  function initSidebar() {
    const aside = document.querySelector('.app-sidebar');
    const handle = document.getElementById('sidebarResizer');
    if (!aside || !handle) return;

    const maxWidth = () => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, (window.innerWidth - 520) / remSize()));
    const current = () => {
      const value = parseFloat(getComputedStyle(root).getPropertyValue('--sidebar-width'));
      return Number.isFinite(value) ? value : 17.25;
    };
    const persist = value => { try { localStorage.setItem(SIDEBAR_KEY, String(value)); } catch (_) {} };
    const clearStored = () => { try { localStorage.removeItem(SIDEBAR_KEY); } catch (_) {} };
    let userWidth = null;
    try {
      const stored = parseFloat(localStorage.getItem(SIDEBAR_KEY));
      if (Number.isFinite(stored) && stored >= SIDEBAR_MIN && stored <= SIDEBAR_MAX) userWidth = stored;
    } catch (_) {}

    function syncAria(value = current()) {
      const now = clamp(value, SIDEBAR_MIN, SIDEBAR_MAX);
      const max = Math.max(maxWidth(), now);
      handle.setAttribute('aria-valuemin', String(SIDEBAR_MIN));
      handle.setAttribute('aria-valuemax', max.toFixed(2));
      handle.setAttribute('aria-valuenow', now.toFixed(2));
      handle.setAttribute('aria-valuetext', `${now.toFixed(2)} rem`);
    }

    function apply(value, save) {
      const width = clamp(value, SIDEBAR_MIN, maxWidth());
      root.style.setProperty('--sidebar-width', `${width.toFixed(2)}rem`);
      if (save) {
        userWidth = width;
        persist(width.toFixed(2));
      }
      syncAria(width);
      return width;
    }

    function reset() {
      userWidth = null;
      root.style.removeProperty('--sidebar-width');
      clearStored();
      requestAnimationFrame(() => syncAria());
    }

    if (userWidth != null) apply(userWidth, false);
    else requestAnimationFrame(() => syncAria());

    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = current();
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
      document.body.classList.add('sidebar-resizing');
      const move = moveEvent => apply(startWidth + (moveEvent.clientX - startX) / remSize(), false);
      const end = endEvent => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        document.body.classList.remove('sidebar-resizing');
        try { handle.releasePointerCapture(endEvent.pointerId); } catch (_) {}
        const width = current();
        userWidth = width;
        persist(width.toFixed(2));
        syncAria(width);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });

    handle.addEventListener('dblclick', event => {
      event.preventDefault();
      reset();
    });

    handle.addEventListener('keydown', event => {
      const step = event.shiftKey ? 2 : 0.5;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        apply(current() - step, true);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        apply(current() + step, true);
      } else if (event.key === 'Home') {
        event.preventDefault();
        reset();
      } else if (event.key === 'End') {
        event.preventDefault();
        apply(maxWidth(), true);
      }
    });

    window.addEventListener('resize', () => {
      if (userWidth != null) apply(Math.min(userWidth, maxWidth()), false);
      else syncAria();
    });

    window.GoViewerSidebar = {
      reset,
      width: () => Math.round(current() * 100) / 100,
      min: SIDEBAR_MIN,
      max: () => Math.round(maxWidth() * 100) / 100
    };
  }

  /* ---------------------------------------------------------
     命令菜单：可见入口 + Ctrl/Cmd+K；搜索人物、赛事、当前届对局，
     并提供“进入试下研究”、核查、主题、呈现与导出等快捷动作。
     --------------------------------------------------------- */
  function initCommands() {
    if (!document.getElementById('btnCommand')) return;
    document.body.insertAdjacentHTML('beforeend', `<dialog id="commandDialog" class="command-dialog" aria-labelledby="commandTitle">
    <div class="command-head">
      <div class="command-head-text">
        <span class="command-title" id="commandTitle">命令菜单</span>
      </div>
      <button class="close-btn" id="commandClose" type="button" aria-label="关闭命令菜单">×</button>
    </div>
    <div class="command-search">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="6" stroke="currentColor" stroke-width="1.6"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      <input id="commandInput" type="text" role="combobox" aria-label="搜索命令、棋手、赛事或对局" aria-autocomplete="list" aria-expanded="true" aria-controls="commandList" aria-activedescendant="" placeholder="搜索棋手、赛事、对局，或输入命令…" autocomplete="off" spellcheck="false">
    </div>
    <div class="command-list" id="commandList" role="listbox" aria-label="命令与搜索结果"></div>
    <div class="command-foot">
      <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
      <span><kbd>Enter</kbd> 执行</span>
      <span><kbd>Esc</kbd> 关闭</span>
      <span class="command-count" id="commandCount" role="status" aria-live="polite"></span>
    </div>
  </dialog>`);
    const dialog = document.getElementById('commandDialog');
    const input = document.getElementById('commandInput');
    const list = document.getElementById('commandList');
    const count = document.getElementById('commandCount');
    const trigger = document.getElementById('btnCommand');
    if (!dialog || !input || !list || !trigger) return;
    let items = [], active = -1, lastFocus = null;
    let remoteQuery = '', remoteMatches = [], remotePlayers = [], remoteEditions = [], remoteTimer = 0, remoteToken = 0;
    const standalone = !document.getElementById('mainView');
    const themeCommands = [
      ['light', '浅色外观', 'sun', '浅色 主题 外观 light'],
      ['dark', '深色外观', 'moon', '深色 主题 外观 dark'],
      ['auto', '跟随系统外观', 'monitor', '跟随 系统 自动 主题 auto'],
    ].map(([key, label, icon, keywords]) => ({section: 'view', label, icon, keywords,
      run: () => window.GoViewerTheme?.setPreference(key)}));

    const tableOpen = () => !document.getElementById('tableView')?.hidden;
    const editMode = () => document.body.classList.contains('edit-mode');
    const isWiki = () => document.getElementById('btnViewWiki')?.classList.contains('active');
    const isDraw = () => document.getElementById('btnViewDraw')?.classList.contains('active');
    const isVertical = () => document.body.dataset.bracketOrientation === 'vertical';
    const themePref = () => document.body.dataset.themePref || 'light';
    const currentEdition = () => window.GoViewerNavigate?.currentEdition?.() || '';
    const currentData = () => allData[currentEdition()] || null;

    function canUse(id) {
      const element = document.getElementById(id);
      if (!element || element.disabled) return false;
      if (element.classList.contains('edit-only') && !editMode()) return false;
      return true;
    }
    function click(id) {
      const element = document.getElementById(id);
      if (element && !element.disabled) element.click();
    }
    function currentMatches() {
      const data = currentData();
      if (!data) return [];
      return (data.rounds || []).flatMap(round => (round.matches || []).map(match => ({round, match})));
    }
    function latestFirst(a, b) {
      return (b.round.round_order - a.round.round_order)
        || String(b.match.date || '').localeCompare(String(a.match.date || ''))
        || ((b.match.match_number || 0) - (a.match.match_number || 0));
    }
    function matchNames(match) {
      return M.participants(match).map(player => player?.name_zh || player?.id || '待定');
    }
    function matchText(match) {
      return matchNames(match).join(' / ');
    }

    function commandDefinitions() {
      if (standalone) return [
        {section: 'nav', label: '赛事档案', icon: 'calendar', keywords: '赛事 目录', run: () => { location.href = 'index.html'; }},
        {section: 'nav', label: '对手交锋', icon: 'person', keywords: '对手 交锋', run: () => { location.href = 'head-to-head.html'; }},
        {section: 'nav', label: '等级分', icon: 'trophy', keywords: '等级分 榜单', run: () => { location.href = 'ratings.html'; }},
        ...themeCommands,
        {section: 'view', id: 'spoiler-toggle', label: document.body.dataset.spoiler === 'hidden' ? '关闭防剧透模式（显示赛果）' : '开启防剧透模式（隐藏赛果）', meta: '可点击单局单独揭示', icon: 'eye', keywords: '防剧透 剧透 隐藏 赛果 spoiler', run: () => window.GoViewerSpoiler?.toggle?.()},
      ];
      const definitions = [
        {section: 'nav', id: 'people', label: '打开人物档案', meta: '搜索、查看与新建人物', icon: 'person', keywords: '人物 棋手 档案 people player', run: () => click('btnPeople')},
        {section: 'nav', id: 'ratings', label: '打开等级分工作区', meta: '榜单、对比与走势', icon: 'trophy', keywords: '等级分 榜单 排名 对比 走势 ratings ranking', run: () => click('btnRatings')},
        {section: 'nav', id: 'review', label: '打开待核工作区', meta: '连续核查、记录结论与撤销', icon: 'review', keywords: '待核 核查 问题 review issue', run: () => click('btnReview')},
        {section: 'nav', id: 'history', label: '打开修改历史', meta: '按届次、对局与日期筛选', icon: 'history', keywords: '修改 历史 撤销 history undo', run: () => click('btnHistory'), element: 'btnHistory'},
        {section: 'nav', id: 'hof', label: '查看冠军榜', meta: '世界大赛冠亚军统计', icon: 'trophy', keywords: '冠军 榜 排名 hof champion', run: () => click('btnHof')},
        {section: 'nav', id: 'roster', label: '查看本届参赛名单', meta: '本届已登记棋手与规模', icon: 'users', keywords: '参赛 名单 棋手 roster players', run: () => click('btnEditionRoster')},
        {section: 'nav', id: 'entry', label: '新增比赛', meta: '分步录入，草稿不进入正式目录', icon: 'edit', keywords: '新增 比赛 录入 entry', run: () => click('btnEntry'), element: 'btnEntry'},
        {section: 'view', id: 'table', label: tableOpen() ? '返回对阵图' : '打开对局表格', meta: tableOpen() ? '关闭表格筛选与列表' : '按赛事、届次、轮次筛选对局', icon: tableOpen() ? 'bracket' : 'table', keywords: '对局 表格 列表 table bracket', run: () => click(tableOpen() ? 'btnViewChart' : 'btnViewTable')},
        {section: 'view', id: 'presentation', label: isWiki() ? '切换为卡片式对阵' : '切换为紧凑表格式对阵', meta: `当前：${isDraw() ? '抽签展板式' : isWiki() ? '紧凑表格式' : '卡片式'}`, icon: 'bracket', keywords: '卡片 紧凑 呈现 布局 modern wiki', run: () => click(isWiki() ? 'btnViewModern' : 'btnViewWiki')},
        ...(!document.getElementById('btnViewDraw')?.hidden && !isDraw() ? [{section: 'view', id: 'presentation-draw', label: '切换为抽签展板式对阵', meta: '按比赛日与原始签位自下而上展示', icon: 'bracket', keywords: '抽签 展板 签位 draw', run: () => click('btnViewDraw')}] : []),
        ...(!document.getElementById('orientationToggleGroup')?.hidden ? [{section: 'view', id: 'orientation', label: isVertical() ? '切换为横版对阵' : '切换为竖版对阵', meta: `当前：${isVertical() ? '竖版（自上而下）' : '横版（自左向右）'}`, icon: 'bracket', keywords: '横版 竖版 方向 orientation horizontal vertical', run: () => click(isVertical() ? 'btnOrientHorizontal' : 'btnOrientVertical')}] : []),
        {section: 'view', id: 'export', label: '导出对阵图', meta: '导出 PNG 或 SVG', icon: 'download', keywords: '导出 图片 svg png export', run: () => click('btnExportBracket')},
        {section: 'view', id: 'theme-light', label: '切换为浅色外观', meta: themePref() === 'light' ? '当前' : '暖灰浅色', icon: 'sun', keywords: '浅色 主题 外观 theme light', run: () => click('btnThemeLight')},
        {section: 'view', id: 'theme-dark', label: '切换为深色外观', meta: themePref() === 'dark' ? '当前' : '分层炭灰', icon: 'moon', keywords: '深色 主题 外观 theme dark', run: () => click('btnThemeDark')},
        {section: 'view', id: 'theme-auto', label: '跟随系统外观', meta: themePref() === 'auto' ? '当前' : '随系统明暗自动切换', icon: 'monitor', keywords: '跟随 系统 自动 主题 theme auto', run: () => click('btnThemeAuto')},
        {section: 'view', id: 'spoiler-toggle', label: document.body.dataset.spoiler === 'hidden' ? '关闭防剧透模式（显示赛果）' : '开启防剧透模式（隐藏赛果）', meta: '可点击单局单独揭示', icon: 'eye', keywords: '防剧透 剧透 隐藏 赛果 spoiler', run: () => window.GoViewerSpoiler?.toggle?.()},
        {section: 'view', id: 'edit-mode', label: editMode() ? '关闭编辑模式' : '开启编辑模式', meta: editMode() ? '退出编辑' : '允许修改资料与棋谱关联', icon: 'edit', keywords: '编辑 模式 edit', run: () => click('btnEditMode')}
      ];
      return definitions.filter(item => !item.element || canUse(item.element));
    }

    function matchesCommand(item, query) {
      if (!query) return true;
      const haystack = normalize([item.label, item.meta, item.keywords, item.section === 'nav' ? '前往' : '视图'].join(' '));
      return haystack.includes(query);
    }

    function playerScore(player, query) {
      const fields = [player.name_zh, player.name_native, player.name_romanized, player.id].filter(Boolean).map(normalize);
      if (fields.some(value => value === query)) return 0;
      if (fields.some(value => value.startsWith(query))) return 1;
      return 2;
    }

    function collect(query) {
      const q = normalize(query).trim();
      const groups = [];
      const definitions = commandDefinitions().filter(item => matchesCommand(item, q));
      for (const [section, label] of [['nav', '前往'], ['view', '视图与外观']]) {
        const sectionItems = definitions.filter(item => item.section === section).map(item => ({
          kind: 'command', label: item.label, meta: item.meta, icon: item.icon, run: item.run
        }));
        if (sectionItems.length) groups.push({key: section, label, items: sectionItems});
      }

      if (q) {
        const currentPlayers = standalone ? (remoteQuery === q ? remotePlayers : [])
          : ((window.PLAYERS_DATA && window.PLAYERS_DATA.length) ? window.PLAYERS_DATA : playerDirectory);
        const currentAliases = {
          ids: window.PLAYER_ID_ALIASES || aliases.ids || {},
          names: window.PLAYER_NAME_ALIASES || aliases.names || {},
        };
        const matchedPlayers = currentPlayers
          .filter(player => standalone || M.matchesPlayerQuery(player, q, currentAliases))
          .map(player => ({player, score: playerScore(player, q)}))
          .sort((a, b) => a.score - b.score || String(a.player.name_zh || '').localeCompare(String(b.player.name_zh || ''), 'zh-CN'))
          .slice(0, 6)
          .map(({player}) => ({
            kind: 'player',
            label: player.name_zh || player.id,
            meta: [player.name_native && player.name_native !== player.name_zh ? player.name_native : '',
              player.name_romanized && player.name_romanized !== player.name_native ? player.name_romanized : '',
              flags.info(player.nationality).name || ''].filter(Boolean).join(' · '),
            iconHtml: player.nationality ? flags.html(player.nationality) : svg('person'),
            run: () => {
              if (standalone) location.href = 'player.html?id=' + encodeURIComponent(player.id);
              else window.showPlayer(player.id);
            }
          }));
        if (matchedPlayers.length) groups.push({key: 'players', label: '棋手', items: matchedPlayers});

        const matchedEditions = (standalone ? (remoteQuery === q ? remoteEditions : []) : indexList)
          .filter(edition => standalone || normalize([edition.tournament_short, edition.tournament_name,
            `${M.editionLabel(edition)}`, edition.edition_number, edition.year, edition.champion,
            edition.runner_up, edition.id].join(' ')).includes(q))
          .sort((a, b) => b.seq - a.seq)
          .slice(0, 6)
          .map(edition => ({
            kind: 'edition',
            label: `${edition.tournament_short} ${M.editionLabel(edition)}`,
            meta: `${edition.year} · ${edition.champion ? `冠军 ${edition.champion}` : '冠军待定'}`,
            badge: edition.id === currentEdition() ? '当前' : '',
            icon: 'calendar',
            run: () => {
              if (standalone) location.href = 'index.html?ed=' + encodeURIComponent(edition.id);
              else window.GoViewerNavigate?.loadEdition?.(edition.id);
            }
          }));
        if (matchedEditions.length) groups.push({key: 'editions', label: '赛事', items: matchedEditions});

        const localMatches = currentMatches()
          .filter(({round, match}) => normalize([round.round_name, match.bracket_code,
            matchText(match), M.matchResult(match), M.dateLabel(match.date), match.id,
            match.sgf?.present ? '有棋谱 棋谱' : '', '对局 比赛 match'].join(' ')).includes(q))
          .sort(latestFirst);
        const seenMatchIds = new Set(localMatches.map(({match}) => match.id));
        const extraRemote = (remoteQuery === q ? remoteMatches : [])
          .filter(item => item && item.id && !seenMatchIds.has(item.id));
        const matchedMatches = [
          ...localMatches.slice(0, 5).map(({round, match}) => ({
            kind: 'match',
            label: `${round.round_name} · ${matchText(match)}`,
            meta: `${M.matchResult(match)} · ${M.dateLabel(match.date)}${match.sgf?.present || match.has_sgf ? ' · 有棋谱' : ''}`,
            icon: 'bracket',
            run: () => window.GoViewerNavigate?.showMatchDetails?.(match)
          })),
          ...extraRemote.slice(0, Math.max(0, 5 - localMatches.length)).map(item => ({
            kind: 'match',
            label: `${item.tournament_short || ''} · ${item.round_name || ''} · ${matchText(item)}`,
            meta: `${M.matchResult(item)} · ${M.dateLabel(item.date)}${item.has_sgf || item.sgf?.present ? ' · 有棋谱' : ''}`,
            icon: 'bracket',
            run: () => {
              if (standalone) location.href = 'index.html?' + new URLSearchParams({ed: item.edition_id, match: item.id, ...(item.has_sgf ? {tab: 'sgf'} : {})});
              else if (window.GoViewerTable?.focusMatch) window.GoViewerTable.focusMatch(item.id, item.edition_id);
              else window.GoViewerNavigate?.focusMatch?.(item.id, item.edition_id);
            }
          })),
        ];
        if (matchedMatches.length) groups.push({key: 'matches', label: '对局', items: matchedMatches});

        const dataClient = window.GoStatsDataClient;
        if (dataClient && typeof dataClient.search === 'function' && remoteQuery !== q) {
          clearTimeout(remoteTimer);
          const token = ++remoteToken;
          remoteTimer = setTimeout(async () => {
            const term = query.trim().slice(0, 40);
            try {
              const requests = [dataClient.search({q: term, page: 1, page_size: 6, sort: 'date_desc'})];
              if (standalone) requests.push(dataClient.searchPlayers(term, 6), dataClient.searchCatalog(term));
              const [matches, players, editions] = await Promise.allSettled(requests);
              if (token !== remoteToken) return;
              remoteQuery = q;
              remoteMatches = matches.value?.items || [];
              remotePlayers = players?.value?.items || [];
              remoteEditions = editions?.value?.items || [];
              if (dialog.open && normalize(input.value).trim() === q) {
                render(input.value);
              }
            } catch (_) {}
          }, 120);
        }
      }

      const studies = currentMatches()
        .filter(({match}) => match.sgf?.present)
        .filter(({round, match}) => !q || normalize([round.round_name, matchText(match), M.dateLabel(match.date),
          match.bracket_code, match.id, '研究 试下 棋谱 study'].join(' ')).includes(q))
        .sort(latestFirst)
        .slice(0, q ? 5 : 4)
        .map(({round, match}) => ({
          kind: 'study',
          label: `进入研究 · ${matchText(match)}`,
          meta: `${round.round_name} · ${M.dateLabel(match.date)} · ${match.sgf.main_line_moves || 0} 手`,
          badge: '试下研究',
          icon: 'play',
          run: () => {
            window.GoViewerNavigate?.showMatchDetails?.(match);
            if (window.GoViewerSgf?.openStudy) window.GoViewerSgf.openStudy(match.id);
            else window.GoViewerSgf?.openMatch?.(match.id);
          }
        }));
      if (studies.length) groups.push({key: 'studies', label: '研究', items: studies});
      return groups;
    }

    function iconHtml(item) {
      if (item.iconHtml) return item.iconHtml;
      return svg(item.icon || 'arrow');
    }

    function render(query) {
      const groups = collect(query);
      const order = ['nav', 'players', 'editions', 'matches', 'studies', 'view'];
      groups.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
      items = [];
      let index = 0;
      let markup = '';
      for (const group of groups) {
        markup += `<div class="command-group" data-command-group="${E(group.key)}" role="group" aria-label="${E(group.label)}">` +
          `<div class="command-group-label" aria-hidden="true">${E(group.label)}</div>`;
        for (const item of group.items) {
          item.domId = `command-option-${index}`;
          item.index = index;
          items.push(item);
          markup += `<div class="command-option" role="option" id="${item.domId}" tabindex="-1" data-command-index="${index}" aria-selected="false">` +
            `<span class="command-option-icon" aria-hidden="true">${iconHtml(item)}</span>` +
            `<span class="command-option-text"><span class="command-option-label">${text(item.label)}</span>` +
            `${item.meta ? `<span class="command-option-meta">${text(item.meta)}</span>` : ''}</span>` +
            `${item.badge ? `<span class="command-option-badge">${text(item.badge)}</span>` : ''}</div>`;
          index += 1;
        }
        markup += '</div>';
      }
      list.innerHTML = markup || '<div class="command-empty"><strong>没有匹配的命令、棋手或赛事</strong><p>试试姓名、赛事简称、年份，或输入“研究”“待核”“深色”。</p></div>';
      if (count) count.textContent = `${items.length} 项`;
      active = items.length ? 0 : -1;
      setActive(active, false);
    }

    function setActive(next, scroll = true) {
      if (!items.length) {
        active = -1;
        input.removeAttribute('aria-activedescendant');
        return;
      }
      active = (next + items.length) % items.length;
      list.querySelectorAll('.command-option.is-active').forEach(element => {
        element.classList.remove('is-active');
        element.setAttribute('aria-selected', 'false');
      });
      const element = document.getElementById(items[active].domId);
      if (!element) return;
      element.classList.add('is-active');
      element.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', element.id);
      if (scroll) element.scrollIntoView({block: 'nearest'});
    }

    function focusInput() {
      input.focus({preventScroll: true});
      input.select();
    }

    function close(restore = true) {
      if (!dialog.open) return;
      dialog.close();
      if (restore && lastFocus instanceof HTMLElement && lastFocus.isConnected) {
        lastFocus.focus({preventScroll: true});
      }
      lastFocus = null;
    }

    function open() {
      if (dialog.open) { focusInput(); return; }
      if (document.querySelector('dialog[open]')) return;
      lastFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : trigger;
      const dropdown = document.getElementById('searchDropdown');
      if (dropdown) dropdown.style.display = 'none';
      document.getElementById('searchInput')?.setAttribute('aria-expanded', 'false');
      input.value = '';
      render('');
      dialog.showModal();
      requestAnimationFrame(focusInput);
    }

    function execute(item) {
      if (!item || typeof item.run !== 'function') return;
      close(true);
      try { item.run(); } catch (error) { console.error('命令执行失败', error); }
    }

    input.addEventListener('input', () => render(input.value));
    input.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(active + 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(active - 1); }
      else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
      else if (event.key === 'End') { event.preventDefault(); setActive(items.length - 1); }
      else if (event.key === 'Enter') {
        event.preventDefault();
        if (active >= 0) execute(items[active]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    });
    list.addEventListener('mousemove', event => {
      const option = event.target.closest('[data-command-index]');
      if (option) setActive(Number(option.dataset.commandIndex), false);
    });
    list.addEventListener('click', event => {
      const option = event.target.closest('[data-command-index]');
      if (option) execute(items[Number(option.dataset.commandIndex)]);
    });
    document.getElementById('commandClose')?.addEventListener('click', () => close(true));
    dialog.addEventListener('click', event => { if (event.target === dialog) close(true); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(true); });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') event.stopPropagation();
    });

    const label = document.getElementById('commandShortcutLabel');
    if (label) label.textContent = shortcutLabel;
    const triggerLabel = document.querySelector('.command-trigger-kbd');
    if (triggerLabel) triggerLabel.textContent = shortcutLabel;
    trigger.title = `命令菜单（${shortcutLabel}）`;
    trigger.setAttribute('aria-keyshortcuts', isMac ? 'Meta+K' : 'Control+K');
    trigger.addEventListener('click', open);

    registerShortcut('mod+k', () => {
      if (dialog.open) focusInput();
      else open();
    }, {description: '打开命令菜单', dialogId: 'commandDialog'});

    window.GoViewerCommand = {open, close: () => close(true), isOpen: () => dialog.open};
  }

  // 在各子页脚本绑定主题按钮前挂载顶栏。
  function mountStandaloneHeader() {
    const {standalonePage: active, themeToggleId: themeId} = document.body.dataset;
    const navItems = [
      {key: 'tournaments', label: '赛事资料', href: 'index.html'},
      {key: 'player', label: '人物档案', href: 'index.html#people'},
      {key: 'ratings', label: '等级分', href: 'ratings.html'},
      {key: 'h2h', label: '对手交锋', href: 'head-to-head.html'}
    ];
    const navHtml = navItems.map(item => {
      const isCurrent = item.key === active;
      return `<a class="nav-link${isCurrent ? ' is-active' : ''}" href="${item.href}"${isCurrent ? ' aria-current="page"' : ''}>${item.label}</a>`;
    }).join('');
    const themeBtnHtml = themeId
      ? `<button type="button" class="btn btn-sm standalone-theme-btn" id="${E(themeId)}">切换外观</button>`
      : '';
    const header = document.createElement('header');
    header.className = 'app-header app-header--standalone';
    header.innerHTML = `
      <a class="header-brand header-brand-link" href="index.html">
        <div class="logo-badge" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M7 4v24M16 4v24M25 4v24M4 7h24M4 16h24M4 25h24" stroke="currentColor" opacity=".25"/><circle cx="16" cy="16" r="6" fill="currentColor"/><circle cx="25" cy="7" r="4" fill="var(--bg-secondary)" stroke="currentColor"/></svg></div>
        <div class="title-group"><span class="brand-title">国际围棋赛事档案</span></div>
      </a>
      <nav class="global-nav" aria-label="全局导航">${navHtml}</nav>
      <div class="header-actions">
        <button class="command-trigger" id="btnCommand" type="button" aria-label="打开命令菜单" aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K" title="打开命令菜单（${shortcutLabel}）">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 7 4 12l5 5M15 7l5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span class="command-trigger-label">搜索</span>
          <kbd class="command-trigger-kbd">${shortcutLabel}</kbd>
        </button>
        <button type="button" class="btn btn-sm spoiler-toggle-btn" id="btnSpoilerToggle" aria-pressed="false" title="开启后隐藏胜负赛果，点击单局可单独揭示">防剧透</button>
        ${themeBtnHtml}
      </div>`;
    document.body.insertBefore(header, document.body.firstChild);
  }

  if (document.body?.dataset.standalonePage) {
    mountStandaloneHeader();
  }

  /* ---------------------------------------------------------
     全站防剧透模式：隐藏胜负结果，支持点击单局/卡片单独揭示，
     并在存储受限场景通过 URL ?spoiler=1 在站内导航间安全透传。
     --------------------------------------------------------- */
  const SPOILER_KEY = 'go_viewer_spoiler_v1';
  let spoilerMemoryHidden = (document.body && document.body.dataset && document.body.dataset.spoiler === 'hidden') || false;

  function canUseStorage() {
    try {
      const k = '__go_spoiler_probe__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (_) {
      return false;
    }
  }

  function syncSpoilerLinks(hidden) {
    if (canUseStorage()) return;
    document.querySelectorAll('.app-header--standalone .global-nav a[href], .app-header--standalone .header-brand-link[href]').forEach(link => {
      try {
        const url = new URL(link.getAttribute('href'), location.href);
        if (hidden) url.searchParams.set('spoiler', '1');
        else url.searchParams.delete('spoiler');
        link.setAttribute('href', url.pathname.split('/').pop() + url.search + url.hash);
      } catch (_) {}
    });
  }

  function syncSpoilerButton(hidden) {
    const btn = document.getElementById('btnSpoilerToggle');
    if (!btn) return;
    btn.classList.toggle('is-active', hidden);
    btn.setAttribute('aria-pressed', String(hidden));
    btn.textContent = hidden ? '已防剧透' : '防剧透';
    btn.title = hidden ? '防剧透已开启：点击关闭并显示全部赛果' : '开启后隐藏胜负赛果，点击单局可单独揭示';
  }

  function setSpoilerHidden(hidden, persist = true) {
    const next = Boolean(hidden);
    spoilerMemoryHidden = next;
    if (document.body) {
      document.body.dataset.spoiler = next ? 'hidden' : 'visible';
      if (!next) {
        document.querySelectorAll('.spoiler-revealed').forEach(el => el.classList.remove('spoiler-revealed'));
      }
    }
    if (persist) {
      try { localStorage.setItem(SPOILER_KEY, next ? 'hidden' : 'visible'); } catch (_) {}
      const url = new URL(location.href);
      if (url.searchParams.has('spoiler') || !canUseStorage()) {
        url.searchParams.set('spoiler', next ? '1' : '0');
        try { history.replaceState(history.state, '', url); } catch (_) {}
      }
    }
    syncSpoilerButton(next);
    syncSpoilerLinks(next);
    try {
      window.dispatchEvent(new CustomEvent('go:spoiler-changed', {detail: {hidden: next}}));
    } catch (_) {}
    return next;
  }

  window.GoViewerSpoiler = {
    isHidden: () => spoilerMemoryHidden,
    setHidden: setSpoilerHidden,
    toggle: () => setSpoilerHidden(!spoilerMemoryHidden, true)
  };

  function initSpoiler() {
    let initial = spoilerMemoryHidden;
    try {
      const q = new URLSearchParams(location.search).get('spoiler');
      if (q === '1' || q === 'hidden') initial = true;
      else if (q === '0' || q === 'visible') initial = false;
      else if (localStorage.getItem(SPOILER_KEY) === 'hidden') initial = true;
    } catch (_) {}
    setSpoilerHidden(initial, false);

    const btn = document.getElementById('btnSpoilerToggle');
    if (btn) btn.addEventListener('click', () => window.GoViewerSpoiler.toggle());

    window.addEventListener('storage', event => {
      if (event.key === SPOILER_KEY) {
        setSpoilerHidden(event.newValue === 'hidden', false);
      }
    });

    // 点击赛果先揭示，保留对局卡片和「详情」原有的打开行为。
    document.addEventListener('click', event => {
      if (!spoilerMemoryHidden || !(event.target instanceof Element)) return;
      const source = event.target;
      const control = source.closest('a, button, input, select');
      const score = source.closest('.wiki-score-td, .wiki-r1-score, .player-outcome, .result-badge, .draw-winner-result, #matchesTableBody td:nth-child(6), .h2h-games-table td:is([data-label="胜者"], [data-label="赛果"])');
      const target = score
        ? score.closest('.wiki-match-table, .wiki-r1-row, .match-card, .draw-winner-box, tr[data-table-match], .h2h-games-table tr') || score
        : source.closest('.player-games-result, .podium-name, .h2h-bar, .h2h-figures, .h2h-rate, .h2h-tally, .player-recent-form, .h2h-recent-form, .career-matrix td');
      if (!target || (control && !control.matches('.result-badge'))) return;
      if (control && target.classList.contains('spoiler-revealed')) return;
      event.preventDefault();
      event.stopPropagation();
      target.classList.toggle('spoiler-revealed');
    }, true);
  }

  function init() {
    initSidebar();
    initSpoiler();
    initCommands();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
