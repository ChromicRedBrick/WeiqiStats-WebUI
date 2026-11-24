/* 首屏防闪屏引导：统一解析主题偏好；首页额外恢复视图呈现、排布方向与侧栏宽度。 */
(function () {
  var pref = 'light';
  var isIndex = Boolean(document.body && document.body.dataset && document.body.dataset.bootIndex === '1');
  var presentation = 'wiki';
  var orientation = 'horizontal';
  var storedSidebarCollapsed = false;
  var params = new URLSearchParams(location.search);
  try {
    var legacy = isIndex ? localStorage.getItem('go_bracket_view_mode_v2') : null;
    var storedTheme = localStorage.getItem('go_viewer_theme_v1');
    if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'auto') pref = storedTheme;
    else if (isIndex && legacy === 'modern') pref = 'dark';

    if (isIndex) {
      var storedPres = localStorage.getItem('go_bracket_presentation_v1');
      var storedOrient = localStorage.getItem('go_bracket_orientation_v1');
      presentation = (storedPres === 'modern' || storedPres === 'wiki') ? storedPres
        : (legacy === 'modern' ? 'modern' : 'wiki');
      if (storedOrient === 'horizontal' || storedOrient === 'vertical') orientation = storedOrient;
      var storedSidebar = parseFloat(localStorage.getItem('go_sidebar_width_v1'));
      if (isFinite(storedSidebar) && storedSidebar >= 13 && storedSidebar <= 26) {
        document.documentElement.style.setProperty('--sidebar-width', storedSidebar + 'rem');
      }
      storedSidebarCollapsed = localStorage.getItem('go_sidebar_collapsed_v1') === '1';
    }
  } catch (_) {}

  var qTheme = params.get('theme');
  if (qTheme === 'light' || qTheme === 'dark' || qTheme === 'auto') pref = qTheme;
  if (isIndex) {
    var qMode = params.get('mode');
    var qOrient = params.get('orient');
    if (qMode === 'modern' || qMode === 'wiki' || qMode === 'draw') presentation = qMode;
    if (qOrient === 'horizontal' || qOrient === 'vertical') orientation = qOrient;
  }

  var resolved = pref === 'dark' || (pref === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    ? 'dark' : 'light';
  document.documentElement.dataset.themePref = pref;
  var spoiler = 'visible';
  try {
    var qSpoiler = params.get('spoiler');
    if (qSpoiler === '1' || qSpoiler === 'hidden') spoiler = 'hidden';
    else if (qSpoiler === '0' || qSpoiler === 'visible') spoiler = 'visible';
    else if (localStorage.getItem('go_viewer_spoiler_v1') === 'hidden') spoiler = 'hidden';
  } catch (_) {}

  if (document.body) {
    document.body.dataset.themePref = pref;
    document.body.dataset.theme = resolved;
    document.body.style.colorScheme = resolved;
    document.body.dataset.spoiler = spoiler;
    if (isIndex) {
      document.body.dataset.viewMode = presentation;
      document.body.dataset.bracketOrientation = orientation;
      if (storedSidebarCollapsed) document.body.classList.add('sidebar-collapsed');
    }
  }
})();
