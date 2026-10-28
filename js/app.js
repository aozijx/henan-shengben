/* ============================================================
   河南专升本 · 查询工具  —  入口模块
   持有 DOM 引用、页签路由、主题按钮、数据加载编排与事件绑定。
   功能按模块拆分：utils / theme / metadata / data / render / query /
   explorer / pipeline / result workspace / export / preferences / stats / bootstrap。
   ============================================================ */

import { esc } from './utils.js';
import * as theme from './theme.js';
import * as explorer from './explorer.js';
import { bindQueryControls, createQueryController } from './query.js';
import { createResultCoordinator } from './result-coordinator.js';
import { renderStatsPage } from './stats-page.js';
import { bootstrapData } from './bootstrap.js';
import { getLatestYear, getSelectableYears, getSortedYears } from './metadata.js';
import { setResultState } from './results-controller.js';

var $ = function (id) { return document.getElementById(id); };
var $q = $('q'), $result = $('result'), $hint = $('hint');
var $suggest = $('suggest');

var currentView = 'query';
var VIEWS = ['query', 'stats', 'about'];
var statsContext = null;
var queryController = null;

/* ---------- 头部统计数字 ---------- */
function initStats(repository, metadata, data) {
  $('stat-spec').textContent = '–';
  $('stat-major').textContent = '–';
  $('stat-score').textContent = '–';
  $('stat-school').textContent = '–';
  $('stat-plan').textContent = '–';
  var latestYear = getLatestYear(metadata);
  data.ensureQueryIndex(latestYear).then(function (mapping) {
    $('stat-spec').textContent = String(mapping.length);
    $('stat-major').textContent = String(data.uniqueMajors(latestYear).length);
  }).catch(function () {
    $('stat-spec').textContent = '暂不可用';
    $('stat-major').textContent = '暂不可用';
  });
  repository.ensureAnalytics(latestYear).then(function (analytics) {
    var schools = new Set();
    var plans = 0;
    var scores = 0;
    (analytics.majors || []).forEach(function (major) {
      if (major.controlScore != null) scores += 1;
      Object.values(major.schoolTypes || {}).forEach(function (type) {
        (type.schools || []).forEach(function (school) {
          if (school.schoolName) schools.add(school.schoolName);
          if (school.hasOrdinaryPlan) plans += 1;
          if (school.hasPovertyPlan) plans += 1;
        });
      });
    });
    $('stat-score').textContent = scores.toLocaleString();
    $('stat-school').textContent = schools.size.toLocaleString();
    $('stat-plan').textContent = plans.toLocaleString();
  }).catch(function () {
    $('stat-school').textContent = '暂不可用';
    $('stat-score').textContent = '暂不可用';
    $('stat-plan').textContent = '暂不可用';
  });
}

function applyYearLabels(metadata) {
  var years = getSortedYears(metadata);
  var selectableYears = getSelectableYears(metadata);
  var latestYear = getLatestYear(metadata);
  document.querySelectorAll('[data-latest-year]').forEach(function (node) { node.textContent = String(latestYear || ''); });
  document.querySelectorAll('[data-mapping-year]').forEach(function (node) {
    node.textContent = String(metadata.queryMappingYear || latestYear || '');
  });
  var collegeYears = Object.keys(metadata.sourceCatalog && metadata.sourceCatalog.colleges || {}).map(Number);
  var collegeYear = collegeYears.length ? Math.max.apply(null, collegeYears) : latestYear;
  document.querySelectorAll('[data-college-year]').forEach(function (node) {
    node.textContent = String(collegeYear || '');
  });
  document.querySelectorAll('[data-year-range]').forEach(function (node) {
    node.textContent = years.length ? years[0] + '–' + years[years.length - 1] : '';
  });
  document.querySelectorAll('[data-selectable-range]').forEach(function (node) {
    node.textContent = selectableYears.length ? selectableYears[0] + '–' + selectableYears[selectableYears.length - 1] : '';
  });
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
  if (v === 'stats' && statsContext) renderStatsPage(statsContext.repository, statsContext.metadata,
    statsContext.controller.getState(), statsContext.data.getMapping(statsContext.controller.getState().focusYear));
  if (location.hash !== '#' + v) location.hash = v;
}
window.addEventListener('hashchange', function () {
  var v = (location.hash || '#query').replace('#', '');
  if (VIEWS.indexOf(v) === -1) v = 'query';
  switchView(v);
});

/* ---------- 数据就绪后 ---------- */
function afterLoad() {
  var v = (location.hash || '').replace('#', '');
  if (v === 'stats') switchView('stats');
}

/* ---------- 事件绑定 ---------- */
bindQueryControls({ input: $q, suggest: $suggest, hint: $hint, result: $result,
  goButton: $('goBtn'), clearButton: $('clearBtn'), getController: function () { return queryController; } });

document.querySelectorAll('.tab').forEach(function (tab) {
  tab.addEventListener('click', function () { switchView(tab.getAttribute('data-view')); });
});
$('stats-edit-filters').addEventListener('click', function () {
  switchView('query');
  var panel = $('explorer').querySelector('.filter-panel');
  if (panel) panel.scrollIntoView({ block: 'start' });
});

/* ---------- 配色切换 ---------- */
function refreshChartsIfVisible() {
  if (currentView === 'stats' && statsContext) renderStatsPage(statsContext.repository, statsContext.metadata,
    statsContext.controller.getState(), statsContext.data.getMapping(statsContext.controller.getState().focusYear));
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

bootstrapData('metadata/school-data.json').then(function (loaded) {
  window.__henanReady = true;
  applyYearLabels(loaded.metadata);
  initStats(loaded.repository, loaded.metadata, loaded.data);
  var explorerController = null;
  var coordinator = createResultCoordinator({
    metadata: loaded.metadata,
    repository: loaded.repository,
    data: loaded.data,
    resultRoot: $result,
    queryInput: $q,
    hint: $hint,
    getState: function () { return explorerController && explorerController.getState(); },
    getDispatch: function () { return explorerController && explorerController.dispatch; },
    isStatsVisible: function () { return currentView === 'stats'; },
    renderStats: function (state, mapping) { renderStatsPage(loaded.repository, loaded.metadata, state, mapping); },
    setQueryYear: function (year) { if (queryController) queryController.setYear(year); },
    runSearch: function () { if (queryController) queryController.doQuery($q, $hint, $result); }
  });
  explorerController = explorer.initExplorer($('explorer'), loaded.metadata, {
    data: loaded.data,
    exportDialog: $('export-fields-dialog'),
    exportButton: $('exportCsv'),
    onStateChange: coordinator.onStateChange,
    onClear: function () {
      $q.value = '';
      $('clearBtn').style.display = 'none';
      $hint.textContent = '';
      setResultState($result, '输入专业名称，回车或点「查询」开始检索', 'empty');
    }
  });
  statsContext = { repository: loaded.repository, metadata: loaded.metadata, data: loaded.data, controller: explorerController };
  queryController = createQueryController(loaded.data, { metadata: loaded.metadata, onResult: coordinator.onQueryResult });
  coordinator.onStateChange(explorerController.getState(), { type: 'INIT' });
  coordinator.start(explorerController.getState().focusYear);
  afterLoad();
}).catch(function (err) {
  setResultState($result, '数据加载失败：' + err.message + '。请确认 metadata 配置及其声明的数据文件完整后刷新页面重试。', 'error');
  var explorerRoot = $('explorer');
  if (explorerRoot) explorerRoot.innerHTML = '<div class="msg-notfound"><b>筛选与导出不可用：</b>' + esc(err.message) + '</div>';
  $hint.textContent = '';
});

var initial = (location.hash || '').replace('#', '');
if (VIEWS.indexOf(initial) === -1) initial = 'query';
switchView(initial);
