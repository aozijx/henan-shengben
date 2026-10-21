/* ============================================================
   河南专升本 · 查询工具  —  入口模块
   持有 DOM 引用、页签路由、主题按钮、数据加载编排与事件绑定。
   功能按模块拆分：utils / theme / data / render / query / stats。
   ============================================================ */

import { esc } from './utils.js';
import * as theme from './theme.js';
import * as data from './data.js';
import * as query from './query.js';
import * as table from './table.js';
import { initCharts } from './stats.js';

var $ = function (id) { return document.getElementById(id); };
var $q = $('q'), $result = $('result'), $hint = $('hint');
var $suggest = $('suggest');

var currentView = 'query';
var VIEWS = ['query', 'table', 'stats', 'about'];

/* ---------- 头部统计数字 ---------- */
function initStats() {
  data.uniqueMajors();
  var schools = {};
  data.COLLEGES.forEach(function (r) { schools[r['学校名称']] = 1; });
  $('stat-spec').textContent = String(data.MAPPING.length);
  $('stat-major').textContent = String(data.ALL_MAJORS.length);
  $('stat-score').textContent = String((data.SCORE_BY_YEAR[2026] || []).length);
  $('stat-school').textContent = String(Object.keys(schools).length);
  $('stat-plan').textContent = String(data.PLANS.length);
}

/* ---------- 页签与路由 ---------- */
function switchView(v) {
  currentView = v;
  VIEWS.forEach(function (name) {
    var sec = $('view-' + name);
    var tab = $('tab-' + name);
    var on = name === v;
    sec.hidden = !on;
    sec.classList.toggle('is-active', on);
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', String(on));
  });
  if (v === 'stats' && data.isReady()) initCharts();
  if (v === 'table' && data.isReady()) table.refreshTable();
  if (location.hash !== '#' + v) location.hash = v;
}
window.addEventListener('hashchange', function () {
  var v = (location.hash || '#query').replace('#', '');
  if (VIEWS.indexOf(v) === -1) v = 'query';
  switchView(v);
});

/* ---------- 数据就绪后 ---------- */
function afterLoad() {
  if ($q.value.trim()) query.doQuery($q, $hint, $result);
  var v = (location.hash || '').replace('#', '');
  if (v === 'stats') switchView('stats');
}

/* ---------- 事件绑定 ---------- */
$q.addEventListener('input', function () {
  query.fillSuggest($suggest, $q.value.trim());
  $('clearBtn').style.display = $q.value ? 'inline-block' : 'none';
});
$q.addEventListener('keydown', function (e) { if (e.key === 'Enter') query.doQuery($q, $hint, $result); });
$('goBtn').addEventListener('click', function () { query.doQuery($q, $hint, $result); });
$('clearBtn').addEventListener('click', function () {
  $q.value = '';
  $q.focus();
  $('clearBtn').style.display = 'none';
  query.doQuery($q, $hint, $result);
});

document.querySelectorAll('.tab').forEach(function (tab) {
  tab.addEventListener('click', function () { switchView(tab.getAttribute('data-view')); });
});

/* ---------- 配色切换 ---------- */
function refreshChartsIfVisible() {
  if (currentView === 'stats' && data.isReady()) initCharts();
}
var themeBtn = $('themeToggle');
if (themeBtn) {
  themeBtn.addEventListener('click', function () {
    var cur = theme.currentThemeMode();
    var next = cur === 'light' ? 'dark' : cur === 'dark' ? 'auto' : 'light';
    theme.applyTheme(next, true);
    refreshChartsIfVisible();
  });
}
theme.systemThemeChangeListener(function () {
  if (theme.currentThemeMode() === 'auto') {
    theme.applyTheme('auto', false);
    refreshChartsIfVisible();
  }
});

/* ---------- 启动 ---------- */
theme.applyTheme(theme.readThemeMode(), false);

data.loadAll().then(function () {
  data.buildIndexes();
  window.__henanReady = true;
  initStats();
  table.initTable();
  afterLoad();
}).catch(function (err) {
  $result.innerHTML = '<div class="msg-notfound"><b>数据加载失败：</b>' + esc(err.message) + '<br>' +
    '请确认 <code>data/</code> 目录完整（8 个 JSON 文件）后刷新页面重试。</div>';
  $hint.textContent = '';
});

var initial = (location.hash || '').replace('#', '');
if (VIEWS.indexOf(initial) === -1) initial = 'query';
switchView(initial);
