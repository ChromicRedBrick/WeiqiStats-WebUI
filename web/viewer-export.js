/* Self-contained bracket snapshots, including file:// use. */
(function () {
  const escape = window.GoViewerModel.escape;
  const dialog = document.getElementById('exportDialog'), status = document.getElementById('exportStatus');
  const pngButton = document.getElementById('btnExportPng'), svgButton = document.getElementById('btnExportSvg');
  const headerStyle = document.getElementById('exportHeaderStyle');
  const omitNote = document.getElementById('exportOmitNote');
  const omitNoteHint = document.getElementById('exportOmitNoteHint');
  const showRoundNumber = document.getElementById('exportShowRoundNumber');
  const showRoundNumberHint = document.getElementById('exportShowRoundNumberHint');
  const showMatchNumber = document.getElementById('exportShowMatchNumber');
  const showMatchNumberHint = document.getElementById('exportShowMatchNumberHint');
  const showSeriesDates = document.getElementById('exportShowSeriesDates');
  const showSeriesDatesHint = document.getElementById('exportShowSeriesDatesHint');
  const orientationField = document.getElementById('exportOrientationField');
  const exportOrientation = document.getElementById('exportOrientation');
  const exportOrientationHint = document.getElementById('exportOrientationHint');
  const exportScale = document.getElementById('exportScale');
  const exportScaleHint = document.getElementById('exportScaleHint');
  const scopeField = document.getElementById('exportScopeField');
  const scopeSelect = document.getElementById('exportScope');
  const HEADER_STYLE_KEY = 'go_bracket_export_header_style_v1';
  const SCOPE_KEY = 'go_bracket_export_scope_v1';
  const ORIENTATION_KEY = 'go_bracket_export_orientation_v1';
  const SCALE_KEY = 'go_bracket_export_scale_v1';
  const OMIT_NOTE_KEY = 'go_bracket_export_omit_note_v1';
  const SHOW_ROUND_NUMBER_KEY = 'go_bracket_export_show_round_number_v1';
  const SHOW_MATCH_NUMBER_KEY = 'go_bracket_export_show_match_number_v1';
  const SHOW_SERIES_DATES_KEY = 'go_bracket_export_show_series_dates_v1';
  let busy = false;
  function updateOrientationHint() {
    if (!exportOrientation || !exportOrientationHint) return;
    exportOrientationHint.textContent = exportOrientation.value === 'horizontal'
      ? '导出时临时切为横版（自左向右），不影响当前页面视图。'
      : exportOrientation.value === 'vertical'
      ? '导出时临时切为竖版（自上而下），不影响当前页面视图。'
      : '导出时按当前页面排布方向生成。';
  }
  function updateScaleHint() {
    if (!exportScale || !exportScaleHint) return;
    const val = Number(exportScale.value) || 2;
    exportScaleHint.textContent = val >= 3
      ? '3× 超清适合打印大图；超过浏览器限制时自动等比收敛。'
      : val === 1
      ? '1× 标准尺寸，文件体积更小、生成更快。'
      : '2× 高清适合日常浏览与分享。';
  }
  try {
    const saved = localStorage.getItem(HEADER_STYLE_KEY);
    if (saved === 'compact' || saved === 'web') headerStyle.value = saved;
    if (omitNote) omitNote.checked = localStorage.getItem(OMIT_NOTE_KEY) === '1';
    if (scopeSelect && localStorage.getItem(SCOPE_KEY) === 'knockout') scopeSelect.value = 'knockout';
    const savedOrient = localStorage.getItem(ORIENTATION_KEY);
    if (exportOrientation && (savedOrient === 'current' || savedOrient === 'horizontal' || savedOrient === 'vertical')) {
      exportOrientation.value = savedOrient;
    }
    const savedScale = localStorage.getItem(SCALE_KEY);
    if (exportScale && (savedScale === '1' || savedScale === '2' || savedScale === '3')) {
      exportScale.value = savedScale;
    }
  } catch (_) { /* Export also works when local storage is unavailable. */ }
  updateOrientationHint();
  updateScaleHint();
  exportOrientation?.addEventListener('change', () => {
    updateOrientationHint();
    try { localStorage.setItem(ORIENTATION_KEY, exportOrientation.value); } catch (_) {}
  });
  exportScale?.addEventListener('change', () => {
    updateScaleHint();
    try { localStorage.setItem(SCALE_KEY, exportScale.value); } catch (_) {}
  });
  function updateHeaderStyle() {
    const isWeb = headerStyle.value === 'web';
    document.getElementById('exportHeaderStyleHint').textContent = isWeb
      ? '保留网页标题、赛事分类与资料标签。'
      : '包含赛事名称、冠亚军、比分与比赛资料。';
    if (omitNote) omitNote.disabled = busy || !isWeb;
    if (omitNoteHint) omitNoteHint.textContent = isWeb
      ? '隐藏标题与赛事标签下方的说明文字。'
      : '仅适用于网页版标题。';
  }
  headerStyle.addEventListener('change', () => {
    updateHeaderStyle();
    try { localStorage.setItem(HEADER_STYLE_KEY, headerStyle.value); } catch (_) {}
  });
  omitNote?.addEventListener('change', () => {
    try { localStorage.setItem(OMIT_NOTE_KEY, omitNote.checked ? '1' : '0'); } catch (_) {}
  });
  function exportUiKinds() {
    const isGroupDouble = Boolean(document.querySelector('#canvas .group-double-section'));
    const isLeague = Boolean(document.querySelector('#canvas .league-results'));
    const hasKnockout = Boolean(document.querySelector('#canvas .stage-knockout, #canvas .league-knockout'));
    return {isGroupDouble, isLeague, hasKnockout};
  }
  function syncScopeOptions(kinds = exportUiKinds()) {
    if (!scopeField || !scopeSelect) return;
    scopeField.hidden = !((kinds.isGroupDouble || kinds.isLeague) && kinds.hasKnockout);
    const optAll = scopeSelect.querySelector('option[value="all"]');
    const optKo = scopeSelect.querySelector('option[value="knockout"]');
    const scopeHint = document.getElementById('exportScopeHint');
    if (kinds.isGroupDouble) {
      if (optAll) optAll.textContent = '完整赛程（小组双败 + 淘汰赛）';
      if (optKo) optKo.textContent = '仅单败淘汰赛段';
      if (scopeHint) {
        scopeHint.textContent = scopeSelect.value === 'knockout'
          ? '仅导出单败淘汰赛段，并保留首轮小组来源角标。'
          : '上方按小组双败网格排列，下方接单败淘汰树。';
      }
    } else {
      if (optAll) optAll.textContent = '循环圈分组与淘汰赛';
      if (optKo) optKo.textContent = '仅淘汰赛';
      if (scopeHint) {
        scopeHint.textContent = scopeSelect.value === 'knockout'
          ? '仅导出淘汰赛及名次赛部分。'
          : '全部循环圈分组自上而下排列。';
      }
    }
  }
  scopeSelect?.addEventListener('change', () => {
    syncScopeOptions();
    try { localStorage.setItem(SCOPE_KEY, scopeSelect.value); } catch (_) {}
  });
  updateHeaderStyle();
  function bindToggle(checkbox, hintEl, storageKey, checkedHint, uncheckedHint) {
    if (!checkbox) return;
    try { checkbox.checked = localStorage.getItem(storageKey) === '1'; } catch (_) {}
    const syncHint = () => {
      if (hintEl) hintEl.textContent = checkbox.checked ? checkedHint : uncheckedHint;
    };
    checkbox.addEventListener('change', () => {
      syncHint();
      try { localStorage.setItem(storageKey, checkbox.checked ? '1' : '0'); } catch (_) {}
    });
    syncHint();
  }
  bindToggle(showRoundNumber, showRoundNumberHint, SHOW_ROUND_NUMBER_KEY, '导出结果保留赛段编号。', '导出结果不显示赛段编号。');
  bindToggle(showMatchNumber, showMatchNumberHint, SHOW_MATCH_NUMBER_KEY, '导出结果保留对局编号。', '导出结果不显示对局编号。');
  bindToggle(showSeriesDates, showSeriesDatesHint, SHOW_SERIES_DATES_KEY, '导出结果在番棋符号下方显示每局日期。', '导出结果不显示番棋逐局日期。');
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  function copyStyled(source, copy) {
    const style = getComputedStyle(source);
    for (const key of style) {
      // Avoid logical/physical property duplicates overriding the export's crop offsets.
      if (/^(margin|padding|border|inset)-(block|inline)|^(min-|max-)?(block|inline)-size$/.test(key)) continue;
      copy.style.setProperty(key, style.getPropertyValue(key));
    }
    copy.style.transition = 'none'; copy.style.animation = 'none'; copy.style.caretColor = 'transparent';
    for (const attr of [...copy.attributes]) if (/^on/i.test(attr.name) || attr.name === 'id' || attr.name.startsWith('data-')) copy.removeAttribute(attr.name);
    if (style.position === 'sticky') copy.style.position = 'static';
    if (source.tagName === 'IMG') {
      const embedded = window.GO_EXPORT_FLAGS?.[source.getAttribute('src')];
      if (!embedded) throw new Error('旗帜导出资料缺失，请确认 data/export_flags.js 已加载。');
      copy.setAttribute('src', embedded); copy.removeAttribute('srcset');
    }
    if (source.matches('.wiki-details-caption, .series-details, .series-actions, .match-card .match-details-btn, .draw-unit-actions, .team-controls, .team-nav, .team-results [data-team-action], .league-controls, .edit-only, .group-double-toggle')) copy.style.display = 'none';
    if (source.matches('.result-badge')) copy.textContent = source.textContent.replace(/ · 详情$/, '');
    // “出线”等文字徽标按内容自适应：导出环境字体度量不同，固定宽高会挤到文字换行溢出框外。
    else if (source.matches('.league-qualified')) Object.assign(copy.style, {width: 'auto', height: 'auto', minWidth: '0', maxWidth: 'none'});
    else [...source.children].forEach((child, i) => copyStyled(child, copy.children[i]));
    // 双败赛程中的日期在静态图里不带“详情”；让日期宽度随导出字体自适应。
    if (source.matches('.league-double-detail')) Object.assign(copy.style, {width: 'auto', height: 'auto', minWidth: '0', maxWidth: 'none', whiteSpace: 'nowrap'});
    if (source.matches('.finals-champion-name, .series-game-winner-name')) {
      Object.assign(copy.style, {width: 'auto', flex: '1 1 auto', minWidth: '0', maxWidth: 'none'});
    } else if (source.matches('.finals-champion-label, .finals-award-badge, .finals-runner-label, .series-mark-text, .origin-group-badge, .drop-ref-badge, .group-double-kicker, .group-double-title, .group-double-meta, .gsl-group-badge, .gsl-adv-tag, .gsl-win-tag, .gsl-qual-chip, .gsl-seed-mark, .double-lane-label, .stage-bridge-label')) {
      Object.assign(copy.style, {width: 'auto', height: 'auto', minWidth: '0', maxWidth: 'none', whiteSpace: 'nowrap'});
    } else if (source.matches('.group-double-header')) {
      Object.assign(copy.style, {width: 'auto', height: 'auto', minHeight: '0', maxHeight: 'none'});
    } else if (source.matches('.group-double-title-group')) {
      Object.assign(copy.style, {width: 'auto', height: 'auto', minWidth: '0', maxWidth: 'none', flexWrap: 'nowrap'});
    } else if (source.matches('.gsl-qualifiers')) {
      Object.assign(copy.style, {width: 'auto', height: 'auto', maxWidth: 'none'});
    } else if (source.matches('.gsl-extra-btn')) {
      Object.assign(copy.style, {width: 'auto', height: 'auto', minWidth: '0', maxWidth: 'none', whiteSpace: 'nowrap'});
    } else if (source.matches('.gsl-qual-name, .gsl-match-label, .gsl-match-res')) {
      Object.assign(copy.style, {width: 'auto', whiteSpace: 'nowrap'});
    } else if (source.matches('.wiki-pname, .player-name, .player-outcome, .match-date, .match-code, .finals-badge-title, .finals-score, .series-game-result, .series-game-date, .series-game-num, .wiki-date-label, .gsl-player-name')) {
      copy.style.width = 'auto';
    }
    if (source.matches('.stage-bridge')) {
      const makeBridgeLine = pseudo => {
        const ps = getComputedStyle(source, pseudo);
        if (!ps || ps.content === 'none' || ps.display === 'none') return null;
        const line = document.createElement('span');
        line.setAttribute('aria-hidden', 'true');
        Object.assign(line.style, {
          display: 'block',
          flex: '1 1 auto',
          height: ps.height || '1px',
          minWidth: '0',
          borderTop: `${ps.borderTopWidth} ${ps.borderTopStyle} ${ps.borderTopColor}`,
        });
        return line;
      };
      const beforeLine = makeBridgeLine('::before');
      const afterLine = makeBridgeLine('::after');
      if (beforeLine) copy.insertBefore(beforeLine, copy.firstChild);
      if (afterLine) copy.appendChild(afterLine);
    }
    if (source.tagName === 'TABLE') copy.style.removeProperty('height');
    if (source.matches('.team-table-scroll, .league-table-scroll')) Object.assign(copy.style, {height: 'auto', maxHeight: 'none', maxWidth: 'none', overflow: 'visible'});
  }
  function webpageHeader(width) {
    const source = document.querySelector('.banner');
    if (!source) throw new Error('网页标题尚未加载，请稍后重试。');
    const header = source.cloneNode(true);
    copyStyled(source, header);
    header.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const removeSelectors = ['.edition-seq', '.banner-actions', '.banner-podium', '.chip-action', '.edit-only', 'a'];
    if (omitNote?.checked) removeSelectors.push('.chip-note');
    header.querySelectorAll(removeSelectors.join(', ')).forEach(el => el.remove());
    for (const button of header.querySelectorAll('button')) {
      if (!button.classList.contains('banner-edit-title')) { button.remove(); continue; }
      const title = document.createElement('span');
      title.className = button.className; title.style.cssText = button.style.cssText;
      title.append(...button.childNodes); button.replaceWith(title);
      Object.assign(title.style, {outline: 'none', boxShadow: 'none', borderColor: 'transparent', background: 'transparent'});
    }
    // Reflow the static header at the exported bracket width. Computed pixel
    // widths/heights from the screen must not clip a long title or time limit.
    Object.assign(header.style, {display: 'block', width: width + 'px', minWidth: '0', maxWidth: 'none',
      height: 'auto', minHeight: '0', maxHeight: 'none', margin: '0', overflow: 'visible', boxSizing: 'border-box', flex: 'none'});
    for (const box of header.querySelectorAll('.banner-main, .banner-head, .banner-head-text, .banner-chips, h2, .banner-edit-title, .banner-edit-title > span')) {
      Object.assign(box.style, {width: 'auto', height: 'auto', minWidth: '0', maxWidth: '100%', minHeight: '0', maxHeight: 'none'});
    }
    for (const chip of header.querySelectorAll('.chip')) {
      Object.assign(chip.style, {width: 'auto', height: 'auto', minWidth: '0', maxWidth: '100%',
        whiteSpace: 'normal', flexShrink: '1', boxSizing: 'border-box'});
    }
    for (const node of [header, ...header.querySelectorAll('*')]) {
      node.removeAttribute('role'); node.removeAttribute('tabindex'); node.removeAttribute('aria-label');
      node.style.cursor = 'default';
    }
    return header;
  }
  function stripHiddenBadges(root, selector) {
    root.querySelectorAll(selector).forEach(el => {
      const host = el.closest('[title]'), text = el.textContent;
      if (host && text && (host.title || '').includes(text)) host.removeAttribute('title');
      el.remove();
    });
  }
  // 循环圈导出：用“全部分组纵向排列”的临时列替换当前分组列，导完即还原；
  // 选择“仅淘汰赛”时暂时移除该列，快照只含淘汰赛部分。
  function applyLeagueExport(canvas, context) {
    const liveLeague = canvas.querySelector('.round-col.league-results');
    const league = context.league;
    if (!liveLeague || !league || !league.groups.length) return null;
    const parent = liveLeague.parentNode, slot = liveLeague.nextSibling;
    const knockoutOnly = Boolean(canvas.querySelector('.league-knockout')) && scopeSelect?.value === 'knockout';
    liveLeague.remove();
    let temp = null;
    const restore = () => { temp?.remove(); parent.insertBefore(liveLeague, slot); };
    if (!knockoutOnly) {
      temp = liveLeague.cloneNode(false);
      try {
        window.GoViewerLeague.renderExport({container: temp, data: league.data, groups: league.groups, scope: league.scope});
      } catch (error) { restore(); throw error; }
      parent.insertBefore(temp, slot);
    }
    return {restore, knockoutOnly};
  }
  function applyGroupDoubleExport(canvas) {
    const liveGroup = canvas.querySelector('.group-double-section');
    if (!liveGroup) return null;
    const liveBridge = canvas.querySelector('.stage-bridge');
    const knockout = canvas.querySelector('.stage-knockout');
    const knockoutOnly = Boolean(knockout) && scopeSelect?.value === 'knockout';
    const wasCollapsed = liveGroup.classList.contains('is-collapsed');
    const parent = liveGroup.parentNode;
    const anchor = liveBridge ? liveBridge.nextSibling : liveGroup.nextSibling;
    const toggleBtn = liveGroup.querySelector('.group-double-toggle');
    const prevText = toggleBtn?.textContent;
    const prevExpanded = toggleBtn?.getAttribute('aria-expanded');
    if (knockoutOnly) {
      liveBridge?.remove();
      liveGroup.remove();
    } else if (wasCollapsed) {
      liveGroup.classList.remove('is-collapsed');
      if (toggleBtn) {
        toggleBtn.textContent = '收起小组赛';
        toggleBtn.setAttribute('aria-expanded', 'true');
      }
    }
    const restore = () => {
      if (knockoutOnly) {
        parent.insertBefore(liveGroup, anchor);
        if (liveBridge) parent.insertBefore(liveBridge, anchor);
      } else if (wasCollapsed) {
        liveGroup.classList.add('is-collapsed');
        if (toggleBtn) {
          toggleBtn.textContent = prevText;
          toggleBtn.setAttribute('aria-expanded', prevExpanded);
        }
      }
    };
    return {restore, knockoutOnly};
  }
  async function snapshot() {
    let context = window.getBracketExportContext();
    const canvas = document.getElementById('canvas');
    if (!context || (!canvas.querySelector('.round-col') && !canvas.querySelector('.draw-board'))) throw new Error('尚未加载对阵图，请稍后重试。');
    await document.fonts.ready;
    const isDraw = context.mode === 'draw';
    const originalOrient = context.orientation;
    const screenZoom = canvas.style.zoom;
    const viewport = canvas.parentElement;
    const scrollLeft = viewport.scrollLeft, scrollTop = viewport.scrollTop;
    const hideRoundNumber = !showRoundNumber?.checked;
    const hideMatchNumber = !showMatchNumber?.checked;
    const displaySeriesDates = Boolean(showSeriesDates?.checked);
    document.body.classList.add('export-capture');
    if (hideRoundNumber) document.body.classList.add('export-hide-round-number');
    if (hideMatchNumber) document.body.classList.add('export-hide-match-number');
    if (displaySeriesDates) document.body.classList.add('export-show-series-dates');
    let leagueExport = null;
    let groupDoubleExport = null;
    let switchedOrient = false;
    try {
      const targetOrient = exportOrientation?.value;
      const orientGroup = document.getElementById('orientationToggleGroup');
      if (!isDraw && orientGroup && !orientGroup.hidden
        && (targetOrient === 'horizontal' || targetOrient === 'vertical')
        && targetOrient !== originalOrient && window.GoViewerBracketOrientation?.setTemporary) {
        window.GoViewerBracketOrientation.setTemporary(targetOrient);
        switchedOrient = true;
        context = window.getBracketExportContext();
      }
      // Measure and style-sample the bracket at 1x scale so CSS zoom never skews borders or text widths.
      canvas.style.zoom = '1';
      leagueExport = applyLeagueExport(canvas, context);
      groupDoubleExport = applyGroupDoubleExport(canvas);
      await frame(); window.prepareBracketExport();
      const canvasWidth = Math.ceil(Math.max(canvas.scrollWidth, canvas.offsetWidth));
      const canvasHeight = Math.ceil(Math.max(canvas.scrollHeight, canvas.offsetHeight));
      const origin = canvas.getBoundingClientRect(), zoom = 1;
      // 循环圈导出：横向决赛条带的实际宽度决定导出时上表应拓宽到的宽度。
      const liveGames = canvas.querySelector('.finals-container.finals-horizontal .finals-games, .wiki-series-horizontal');
      const leagueWidth = liveGames
        ? Math.ceil(liveGames.scrollWidth + (liveGames.classList.contains('finals-games') ? 32 : 0)) : 0;
      // Layout containers can be as tall as the viewport; crop to painted bracket content.
      const boxes = [...canvas.querySelectorAll('.round-header, .wiki-round-pill, .wiki-date-label, .match-card, .wiki-match-table, .wiki-r1-block-table, .wiki-third-title, .finals-container, .finals-champion, .wiki-finals-champion, .third-place-container, .series-node, .draw-date-group, .draw-final-plaque, .draw-champion-box, .draw-final-matchup, .draw-third-unit, .team-results, .team-results .team-board-table, .nongshim-bracket, .nongshim-teams-strip, .nongshim-stage, .nongshim-ladder-table, .nongshim-streak-table, .league-results, .league-table, .group-double-section, .stage-bridge, .gsl-card, .double-lane-divider')]
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => el.getBoundingClientRect()).filter(r => r.width && r.height);
      const left = Math.floor(Math.min(...boxes.map(r => (r.left - origin.left) / zoom)));
      const top = Math.floor(Math.min(...boxes.map(r => (r.top - origin.top) / zoom)));
      const right = Math.ceil(Math.max(...boxes.map(r => (r.right - origin.left) / zoom)));
      const bottom = Math.ceil(Math.max(...boxes.map(r => (r.bottom - origin.top) / zoom)));
      const padding = 24, width = right - left + padding * 2, height = bottom - top + padding * 2;
      const copy = canvas.cloneNode(true); copyStyled(canvas, copy);
      if (isDraw) {
        // Let text use its full intrinsic size when the SVG image uses fallback fonts.
        for (const name of copy.querySelectorAll('.draw-slip-name')) {
          name.style.height = 'auto';
          if (!name.classList.contains('is-horizontal-name')) name.style.width = 'auto';
        }
        copy.querySelectorAll('.draw-unit-actions').forEach(el => el.remove());
      }
      // 已在导出布局中隐藏，克隆后移除可避免编号或标签文字进入 SVG 文本层；同时去掉含编号的悬停标题。
      if (hideRoundNumber) stripHiddenBadges(copy, '.numbering-badge.numbering-round');
      if (hideMatchNumber) stripHiddenBadges(copy, '.numbering-badge:not(.numbering-round)');
      if (!displaySeriesDates) copy.querySelectorAll('.series-outcome-date').forEach(el => el.remove());
      if (document.body.dataset.finalsBadges === 'off') {
        copy.querySelectorAll('.finals-award-badge, .wiki-finals-champion').forEach(el => el.remove());
      }
      if (leagueWidth) {
        const copyLeague = copy.querySelector('.round-col.league-results');
        const copyFinals = copy.querySelector('.round-col.finals-wide');
        if (copyLeague) copyLeague.style.width = leagueWidth + 'px';
        if (copyFinals) copyFinals.style.width = leagueWidth + 'px';
        copy.querySelectorAll('.league-table-scroll, .league-table').forEach(el => {
          el.style.width = '100%';
          el.style.maxWidth = 'none';
        });
        // 表格拉宽后，格内赛果按钮仍带着导出前的固定宽度，需重置为填满单元格。
        copy.querySelectorAll('.league-cell-games, .league-game').forEach(el => {
          el.style.width = '100%';
          el.style.maxWidth = 'none';
          el.style.boxSizing = 'border-box';
        });
        const gamesRow = copy.querySelector('.wiki-series-horizontal, .finals-games');
        if (gamesRow) gamesRow.style.width = '100%';
        copy.querySelectorAll('.wiki-matches-stage, .modern-stage, .series-node, .finals-container').forEach(el => {
          el.style.width = '100%';
        });
      }
      Object.assign(copy.style, {width: canvasWidth + 'px', height: canvasHeight + 'px', minWidth: '0', minHeight: '0',
        margin: '0', zoom: '1', transform: 'none', position: 'absolute', left: padding - left + 'px', top: padding - top + 'px', overflow: 'visible'});
      const connectors = copy.querySelector('.svg-connectors');
      if (connectors) { connectors.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); connectors.setAttribute('viewBox', `0 0 ${canvasWidth} ${canvasHeight}`); }
      copy.querySelectorAll('.gsl-card-svg').forEach(el => el.setAttribute('xmlns', 'http://www.w3.org/2000/svg'));
      const isWiki = context.mode === 'wiki';
      const knockoutOnly = Boolean(leagueExport?.knockoutOnly || groupDoubleExport?.knockoutOnly);
      const modeTag = (isDraw ? '抽签展板式' : (isWiki ? '维基版' : '现代版') + (context.orientation === 'vertical' ? '_竖版' : '')) + (knockoutOnly ? '_淘汰赛' : '');
      const palette = getComputedStyle(document.body);
      const background = palette.getPropertyValue('--canvas-bg').trim() || (isWiki || isDraw ? '#ffffff' : '#17191f');
      const text = palette.getPropertyValue('--text-main').trim() || (isWiki || isDraw ? '#202122' : '#eff0f5');
      const font = '"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif';
      const webHeader = headerStyle.value === 'web';
      const header = webHeader ? webpageHeader(width) : document.createElement('div');
      if (!webHeader) {
        header.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        Object.assign(header.style, {width: width + 'px', padding: '22px 32px 16px', boxSizing: 'border-box',
          background, color: text, fontFamily: font, fontSize: '13px', lineHeight: '1.6'});
        if (isDraw) header.style.textAlign = 'center';
        const summary = [['冠军', context.champion], ['亚军', context.runner], [context.scoreLabel || '决赛总比分', context.score]]
          .filter(([, value]) => !isDraw || (value && value !== '—' && value !== '待定'))
          .map(([label, value]) => `${escape(label)}：${escape(value || '—')}`).join('　');
        header.innerHTML = `<h1 style="font-size:22px;line-height:1.4;margin:0 0 10px">${escape(context.title)}</h1>
        ${summary ? `<p style="margin:0">${summary}</p>` : ''}
        <p style="margin:4px 0 0">${escape(context.period)}　${escape(context.rules)}</p>
        ${context.notice ? `<p style="margin:6px 0 0;opacity:.75;font-size:12px">${escape(context.notice)}</p>` : ''}`;
      }
      Object.assign(header.style, {position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden'});
      document.body.appendChild(header); const headerHeight = Math.ceil(header.getBoundingClientRect().height); header.remove();
      Object.assign(header.style, {position: 'static', left: 'auto', top: 'auto', visibility: 'visible'});
      const totalHeight = headerHeight + height;
      const wrapper = document.createElement('div'); wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      Object.assign(wrapper.style, {width: width + 'px', height: totalHeight + 'px', background, color: text, fontFamily: font, margin: '0', padding: '0', overflow: 'hidden'});
      const crop = document.createElement('div');
      Object.assign(crop.style, {width: width + 'px', height: height + 'px', position: 'relative', overflow: 'hidden'});
      crop.append(copy); wrapper.append(header, crop);
      const serialized = new XMLSerializer().serializeToString(wrapper);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}">
        <title>${escape(context.title)}</title><rect width="100%" height="100%" fill="${background}"/>
        <foreignObject x="0" y="0" width="${width}" height="${totalHeight}">${serialized}</foreignObject></svg>`;
      const filename = `${context.year}_${context.shortName}_${context.editionNumber != null ? `第${context.editionNumber}届_` : ''}${modeTag}_${webHeader ? '网页版标题_' : ''}对阵图`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      return {svg, width, height: totalHeight, filename};
    } finally {
      groupDoubleExport?.restore?.();
      leagueExport?.restore?.();
      document.body.classList.remove('export-capture', 'export-hide-round-number', 'export-hide-match-number', 'export-show-series-dates');
      if (switchedOrient && window.GoViewerBracketOrientation?.setTemporary) {
        window.GoViewerBracketOrientation.setTemporary(originalOrient);
      }
      canvas.style.zoom = screenZoom;
      viewport.scrollLeft = scrollLeft;
      viewport.scrollTop = scrollTop;
      window.prepareBracketExport();
    }
  }
  async function rasterize(snap) {
    const image = new Image();
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(snap.svg);
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('图片生成失败，请改用 SVG 导出。')); });
    const requested = Math.max(1, Math.min(3, Number(exportScale?.value) || 2));
    const maxPixels = requested >= 3 ? 40000000 : 24000000;
    const scale = Math.min(requested, 16384 / Math.max(snap.width, snap.height), Math.sqrt(maxPixels / (snap.width * snap.height)));
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(snap.width * scale); canvas.height = Math.ceil(snap.height * scale);
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法生成 PNG，请使用 SVG 导出。');
    ctx.scale(scale, scale); ctx.drawImage(image, 0, 0);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG 生成失败，请使用 SVG 导出。')), 'image/png'));
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function exportImage(type) {
    if (busy) return; busy = true; pngButton.disabled = svgButton.disabled = headerStyle.disabled = true;
    if (omitNote) omitNote.disabled = true;
    if (showRoundNumber) showRoundNumber.disabled = true;
    if (showMatchNumber) showMatchNumber.disabled = true;
    if (showSeriesDates) showSeriesDates.disabled = true;
    if (exportOrientation) exportOrientation.disabled = true;
    if (exportScale) exportScale.disabled = true;
    if (scopeSelect) scopeSelect.disabled = true;
    status.textContent = '正在生成完整对阵图…';
    try {
      const snap = await snapshot();
      download(type === 'png' ? await rasterize(snap) : new Blob([snap.svg], {type:'image/svg+xml;charset=utf-8'}), snap.filename + '.' + type);
      status.textContent = `已生成 ${type.toUpperCase()}，请在浏览器下载列表查看。`;
    } catch (error) { status.textContent = error.message; }
    finally {
      busy = false; pngButton.disabled = svgButton.disabled = headerStyle.disabled = false;
      if (showRoundNumber) showRoundNumber.disabled = false;
      if (showMatchNumber) showMatchNumber.disabled = false;
      if (showSeriesDates) showSeriesDates.disabled = false;
      if (exportOrientation) exportOrientation.disabled = false;
      if (exportScale) exportScale.disabled = false;
      if (scopeSelect) scopeSelect.disabled = false;
      updateHeaderStyle();
    }
  }
  document.getElementById('btnExportBracket').onclick = () => {
    window.GoViewerTable?.hide();
    const kinds = exportUiKinds();
    syncScopeOptions(kinds);
    const orientGroup = document.getElementById('orientationToggleGroup');
    if (orientationField) orientationField.hidden = !orientGroup || orientGroup.hidden;
    status.textContent = kinds.isLeague
      ? (kinds.hasKnockout ? '导出全部循环圈分组与淘汰赛。' : '导出全部循环圈分组。')
      : kinds.isGroupDouble
      ? (kinds.hasKnockout ? '导出小组双败与淘汰赛。' : '导出小组双败阶段。')
      : document.querySelector('#canvas .nongshim-bracket')
      ? '导出当前农心杯对阵图。'
      : document.querySelector('#canvas .team-results')
      ? '导出当前团体赛视图。'
      : '导出当前对阵图。';
    dialog.showModal();
  };
  pngButton.onclick = () => exportImage('png'); svgButton.onclick = () => exportImage('svg');
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  document.getElementById('closeExportDialog').onclick = () => { if (!busy) dialog.close(); };
})();
