/* ============================================================
   河南专升本 · 查询工具  —  配色主题模块
   浅色 / 深色 / 跟随系统三态，写入 localStorage（key: henan-theme）。
   <head> 内联脚本负责首屏防闪烁，本模块负责切换与按钮状态。
   图表配色由 stats 模块通过 chartPalette() 读取 CSS 变量，深色自动跟随。
   ============================================================ */

export var THEME_KEY = 'henan-theme';
export var THEME_MODES = ['light', 'dark', 'auto'];

var themeMedia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
var themeMode = 'auto';

export function themeLabel(m) {
  return m === 'light' ? '浅色' : m === 'dark' ? '深色' : '跟随系统';
}

export function readThemeMode() {
  try {
    var m = localStorage.getItem(THEME_KEY);
    if (THEME_MODES.indexOf(m) > -1) return m;
  } catch (e) { }
  return 'auto';
}

export function currentThemeMode() {
  return themeMode;
}

function systemPrefersDark() {
  return !!(themeMedia && themeMedia.matches);
}

/* 应用配色：设置根节点 data-theme-mode / data-theme，可选持久化，并更新按钮提示 */
export function applyTheme(m, persist) {
  themeMode = m;
  var root = document.documentElement;
  var dark = m === 'dark' || (m === 'auto' && systemPrefersDark());
  root.setAttribute('data-theme-mode', m);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  if (persist) {
    try { localStorage.setItem(THEME_KEY, m); } catch (e) { }
  }
  var btn = document.getElementById('themeToggle');
  if (btn) {
    var label = '当前配色：' + themeLabel(m) + '，点击切换';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  }
}

/* 系统主题跟随（仅 auto 模式） */
export function systemThemeChangeListener(fn) {
  if (!themeMedia) return null;
  if (themeMedia.addEventListener) themeMedia.addEventListener('change', fn);
  else if (themeMedia.addListener) themeMedia.addListener(fn);
  return themeMedia;
}

/* 图表配色：直接读 CSS 变量，深色模式自动跟随 */
var FALLBACK_TRENDS = ['#1f4e79', '#c2410c', '#4d7c0f', '#8a5a00', '#6b4d8f', '#2e7d74', '#b0435f', '#5b6b7a'];
export function chartPalette() {
  var cs = getComputedStyle(document.documentElement);
  var g = function (n) { return cs.getPropertyValue(n).trim(); };
  return {
    ink: g('--ink') || '#17222e',
    muted: g('--muted') || '#5b6b7a',
    faint: g('--faint') || '#8b99a6',
    grid: g('--chart-grid') || '#edf0f3',
    y2024: g('--chart-2024') || '#a8bccd',
    y2025: g('--chart-2025') || '#2e5f8a',
    y2026: g('--chart-2026') || '#c2410c',
    trends: [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) {
      return g('--trend-' + i) || FALLBACK_TRENDS[i - 1];
    })
  };
}
