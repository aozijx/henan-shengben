/* ============================================================
   河南专升本 · 查询工具  —  入口模块
   持有 DOM 引用、页签路由、主题按钮、数据加载编排与事件绑定。
   功能按模块拆分：utils / theme / metadata / data / render / query /
   explorer / pipeline / preview / export / preferences / stats / bootstrap。
   ============================================================ */

import { esc } from './utils.js';
import * as theme from './theme.js';
import * as data from './data.js';
import * as query from './query.js';
import * as explorer from './explorer.js';
import { initCharts } from './stats.js';
import { bootstrapData } from './bootstrap.js';
import { getLatestYear, getSortedYears } from './metadata.js';
import { normalizeMajorOption, normalizePlanEntry, normalizeScoreSegmentSeries } from './model.js';
import { buildMajorAggregates } from './aggregate.js';
import { renderResultWorkspace } from './results-view.js';

var $ = function (id) { return document.getElementById(id); };
var $q = $('q'), $result = $('result'), $hint = $('hint');
var $suggest = $('suggest');

var currentView = 'query';
var VIEWS = ['query', 'stats', 'about'];
var aggregateRequestId = 0;

function createAggregateRenderer(loaded) {
  var supportedYears = getSortedYears(loaded.metadata);
  var normalizedPlans = {};
  supportedYears.forEach(function (year) {
    normalizedPlans[year] = (loaded.store.plansByYear[year] || []).map(normalizePlanEntry);
  });
  return function renderAggregates(majors, state) {
    if (!majors.length) return;
    var years = (state && state.selectedYears) || supportedYears;
    var requestId = ++aggregateRequestId;
    renderResultWorkspace($result, { status: 'loading', hasQuery: true, aggregates: [] }, loaded.metadata);
    Promise.all(years.map(function (year) { return loaded.repository.ensureScoreSegments(year); }))
      .then(function (segmentFiles) {
        if (requestId !== aggregateRequestId) return;
        var segmentsByYear = {};
        years.forEach(function (year, index) {
          segmentsByYear[year] = (segmentFiles[index].majors || []).map(normalizeScoreSegmentSeries);
        });
        var aggregates = buildMajorAggregates({
          majors: majors.map(function (major) {
            return normalizeMajorOption(major, loaded.metadata.derivedFields && loaded.metadata.derivedFields.publicCourse);
          }),
          years: years,
          plansByYear: normalizedPlans,
          scoresByYear: loaded.store.scoresByYear,
          segmentsByYear: segmentsByYear,
          fallbacksByYear: loaded.store.fallbacksByYear
        });
        renderResultWorkspace($result, { status: 'ready', hasQuery: true, aggregates: aggregates }, loaded.metadata);
      })
      .catch(function (error) {
        if (requestId !== aggregateRequestId) return;
        renderResultWorkspace($result, { status: 'error', hasQuery: true, aggregates: [], error: error.message }, loaded.metadata);
      });
  };
}

/* ---------- 头部统计数字 ---------- */
function initStats() {
  data.uniqueMajors();
  var metadata = data.getMetadata();
  var activeYear = getLatestYear(metadata);
  $('stat-spec').textContent = String(data.MAPPING.length);
  $('stat-major').textContent = String(data.ALL_MAJORS.length);
  $('stat-score').textContent = String((data.SCORE_BY_YEAR[activeYear] || []).length);
  $('stat-school').textContent = String(data.getPlanStats()['院校数']);
  $('stat-plan').textContent = String(data.getPlansByYear(activeYear).length);
}

function applyYearLabels(metadata) {
  var years = getSortedYears(metadata);
  var latestYear = getLatestYear(metadata);
  document.querySelectorAll('[data-latest-year]').forEach(function (node) { node.textContent = String(latestYear || ''); });
  document.querySelectorAll('[data-year-range]').forEach(function (node) {
    node.textContent = years.length ? years[0] + '–' + years[years.length - 1] : '';
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
  if (v === 'stats' && data.isReady()) initCharts();
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

bootstrapData('metadata/school-data.json').then(function (loaded) {
  window.__henanReady = true;
  applyYearLabels(loaded.metadata);
  initStats();
  var renderAggregates = createAggregateRenderer(loaded);
  explorer.initExplorer($('explorer'), loaded.metadata, {
    onFilteredResult: function (majors, state) {
      renderAggregates(majors, state);
    }
  });
  query.setResultListener(explorer.setSearchResult);
  afterLoad();
}).catch(function (err) {
  $result.innerHTML = '<div class="msg-notfound"><b>数据加载失败：</b>' + esc(err.message) + '<br>' +
    '请确认 metadata 配置及其声明的数据文件完整后刷新页面重试。</div>';
  var explorerRoot = $('explorer');
  if (explorerRoot) explorerRoot.innerHTML = '<div class="msg-notfound"><b>筛选与导出不可用：</b>' + esc(err.message) + '</div>';
  $hint.textContent = '';
});

var initial = (location.hash || '').replace('#', '');
if (VIEWS.indexOf(initial) === -1) initial = 'query';
switchView(initial);
