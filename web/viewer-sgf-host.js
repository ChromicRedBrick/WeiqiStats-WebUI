/* 跨页就地看谱宿主：在棋手页与对手交锋页挂载共享棋谱弹窗，
   拦截普通左键点击“棋谱”链接以就地打谱，保留 Ctrl/中键新标签跳转与原始 href。 */
(function () {
  'use strict';

  const archive = new URL('index.html', location.href);

  function ensureDialog() {
    let dialog = document.getElementById('matchDialog');
    if (dialog) return dialog;
    if (!document.body) return null;
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="matchDialog" class="match-dialog match-dialog--sgf-only" aria-labelledby="matchDialogTitle">
        <div class="modal-header">
          <h3 id="matchDialogTitle">棋谱浏览</h3>
          <div class="sgf-host-header-actions">
            <a id="sgfOpenInArchive" class="btn btn-small sgf-host-archive-link" href="index.html" hidden>在赛事页打开</a>
            <form method="dialog"><button class="close-btn" aria-label="关闭棋谱">×</button></form>
          </div>
        </div>
        <div class="match-tabs" id="matchTabs" role="tablist" hidden>
          <button class="match-tab" id="matchTabInfo" type="button" role="tab" aria-selected="false" aria-controls="matchDialogBody" hidden>对局资料</button>
          <button class="match-tab active" id="matchTabSgf" type="button" role="tab" aria-selected="true" aria-controls="sgfPanel" hidden>棋谱</button>
        </div>
        <div id="matchDialogBody" class="modal-body" role="tabpanel" aria-labelledby="matchTabInfo" hidden></div>
        <div id="sgfPanel" class="sgf-panel" role="tabpanel" aria-labelledby="matchTabSgf"></div>
      </dialog>`);
    dialog = document.getElementById('matchDialog');
    if (dialog) {
      dialog.addEventListener('close', () => {
        if (!dialog.open && window.GoViewerSgf?.reset) {
          window.GoViewerSgf.reset();
        }
      });
    }
    return dialog;
  }

  function extractMatchInfo(link) {
    const rawHref = link.getAttribute('href') || '';
    if (!rawHref) return null;
    try {
      const url = new URL(rawHref, location.href);
      if (url.origin !== archive.origin || url.pathname !== archive.pathname) return null;
      const matchId = url.searchParams.get('match') || '';
      const tab = url.searchParams.get('tab') || '';
      if (!matchId || (tab !== 'sgf' && link.dataset.sgfLink !== '1')) return null;
      return {matchId, href: rawHref};
    } catch (_) {
      return null;
    }
  }

  function inferTitle(link) {
    const row = link.closest('tr');
    if (!row) return '棋谱浏览';
    const edition = row.querySelector('.player-games-edition a, td[data-label="赛事／届次"] a')?.textContent?.trim() || '';
    const round = row.querySelector('td[data-label="轮次"]')?.textContent?.trim() || '';
    const parts = [edition, round].filter(Boolean);
    return parts.length ? `棋谱 · ${parts.join(' · ')}` : '棋谱浏览';
  }

  function openInPlace(matchId, href, title) {
    const dialog = ensureDialog();
    const sgf = window.GoViewerSgf;
    if (!dialog || typeof sgf?.openMatch !== 'function') return false;
    const titleEl = document.getElementById('matchDialogTitle');
    if (titleEl) titleEl.textContent = title || '棋谱浏览';
    const archiveLink = document.getElementById('sgfOpenInArchive');
    if (archiveLink) {
      archiveLink.href = href || 'index.html';
      archiveLink.hidden = !href;
    }
    if (!dialog.open) dialog.showModal();
    sgf.openMatch(matchId);
    return true;
  }

  // 同步挂载 #matchDialog，确保紧随其后加载的 viewer-sgf.js 能直接绑定节点。
  ensureDialog();

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    const link = event.target instanceof Element ? event.target.closest('a[href*="tab=sgf"], a[data-sgf-link="1"]') : null;
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const info = extractMatchInfo(link);
    if (!info) return;
    if (openInPlace(info.matchId, info.href, inferTitle(link))) {
      event.preventDefault();
    }
  });

})();
