/* ============================================================
   河南专升本 · 查询工具  —  入口模块
   持有 DOM 引用、页签路由、主题按钮、数据加载编排与事件绑定。
   功能按模块拆分：utils / theme / metadata / data / render / query /
   explorer / pipeline / result workspace / export / preferences / stats / bootstrap。
   ============================================================ */

import { esc } from './utils.js';
import * as theme from './theme.js';
import * as data from './data.js';
import * as query from './query.js';
import * as explorer from './explorer.js';
import { renderStatsPage } from './stats-page.js';
import { bootstrapData } from './bootstrap.js';
import { getLatestYear, getSelectableYears, getSortedYears } from './metadata.js';
import { normalizeCollegeMasterRow, normalizeMajorOption, normalizePlanEntry, normalizeScoreSegmentSeries } from './model.js';
import { buildMajorAggregates, resolveScoreContext } from './aggregate.js';
import { buildResultModel, filterYear } from './result-model.js';
import { buildExpandedMajorHtml } from './results-view.js';
import { renderResultWorkspace, setResultState } from './results-controller.js';
import { lookupScoreSegmentCode } from './score-curves.js';
import { queryRowsFromPublishedSources } from './analytics-query.js';

var $ = function (id) { return document.getElementById(id); };
var $q = $('q'), $result = $('result'), $hint = $('hint');
var $suggest = $('suggest');

var currentView = 'query';
var VIEWS = ['query', 'stats', 'about'];
var aggregateRequestId = 0;
var queryRequestId = 0;
var yearRequestId = 0;
var statsContext = null;

function createAggregateRenderer(loaded) {
  var supportedYears = getSortedYears(loaded.metadata);
  function renderWorkspace(view, years, state, dispatch, onExpand) {
    renderResultWorkspace($result, {
      ...view,
      selectedYears: years,
      resultLayout: state && state.resultLayout,
      filters: state && state.filters,
      sort: state && state.sort
    }, loaded.metadata, dispatch, onExpand);
  }

  return function renderAggregates(majors, state, dispatch) {
    var years = (state && state.selectedYears) || supportedYears;
    var requestId = ++aggregateRequestId;
    if (!majors.length) {
      renderWorkspace({ status: 'ready', hasQuery: Boolean(state && state.specName), aggregates: [] }, years, state, dispatch);
      return;
    }
    renderWorkspace({ status: 'loading', hasQuery: true, aggregates: [] }, years, state, dispatch);
    Promise.resolve([])
      .then(function () {
        if (requestId !== aggregateRequestId) return;
        var segmentsByYear = {};
        years.forEach(function (year) { segmentsByYear[year] = []; });
        var summaryStore = loaded.store.querySummaryStore || { plansByYear: {}, scoresByYear: {}, fallbacksByYear: {} };
        var aggregates = buildMajorAggregates({
          majors: majors.map(function (major) {
            return normalizeMajorOption(major, loaded.metadata.derivedFields && loaded.metadata.derivedFields.publicCourse);
          }),
          years: years,
          plansByYear: data.normalizedPlansForYears(summaryStore, years),
          planPublishedByYear: summaryStore.planPublishedByYear,
          scorePublishedByYear: summaryStore.scorePublishedByYear,
          scoresByYear: summaryStore.scoresByYear,
          segmentsByYear: segmentsByYear,
          fallbacksByYear: summaryStore.fallbacksByYear
        });
        var resultModel = buildResultModel({
          aggregates: aggregates,
          metadata: loaded.metadata,
          selectedYears: years,
          filters: state && state.filters,
          sort: state && state.sort
        });
        renderWorkspace({ status: 'ready', hasQuery: true, aggregates: resultModel.aggregates }, years, state, dispatch,
          function (aggregate, selected, hiddenFields, schoolYears) {
            var detailYears = schoolYears || selected;
            return Promise.all([Promise.all(selected.map(function (year) {
              if (!loaded.metadata.yearSources[year]) return Promise.resolve(null);
              return loaded.repository.ensureScoreSegmentIndex(year).then(function (index) {
                var code = lookupScoreSegmentCode(index, aggregate.major.majorCode);
                return code ? loaded.repository.ensureScoreSegment(year, code) : null;
              });
            })), Promise.all(detailYears.map(function (year) {
              return loaded.repository.ensureCollegeYear(year);
            }))]).then(function (values) {
              var detail = { ...aggregate, years: { ...aggregate.years } };
              detailYears.forEach(function (year, index) {
                var source = values[1][index];
                var yearDetail = buildMajorAggregates({ majors: [aggregate.major], years: [year],
                  plansByYear: { [year]: source.plans.map(normalizePlanEntry) },
                  scoresByYear: { [year]: source.scores },
                  scorePublishedByYear: { [year]: source.scorePublished },
                  planPublishedByYear: { [year]: source.planPublished },
                  fallbacksByYear: { [year]: source.colleges.map(function (row) {
                    return normalizeCollegeMasterRow(row, source.planPublished);
                  }) }
                })[0].years[year];
                yearDetail.planPublished = source.planPublished;
                yearDetail.schools = yearDetail.schools.map(function (school) {
                  return { ...school, planPublished: source.planPublished };
                });
                detail.years[year] = filterYear(yearDetail, state && state.filters || {}, loaded.metadata);
              });
              selected.forEach(function (year, index) {
                var yearValue = detail.years[year];
                if (!yearValue) return;
                var scoreSegments = values[0][index] ? normalizeScoreSegmentSeries(values[0][index]) : null;
                detail.years[year] = { ...yearValue, scoreSegments: scoreSegments,
                  scoreContext: resolveScoreContext(scoreSegments, null, yearValue.score) };
              });
              return { html: buildExpandedMajorHtml(detail, selected, hiddenFields, schoolYears) };
            }).catch(function (error) { return { error: error.message }; });
          });
      })
      .catch(function (error) {
        if (requestId !== aggregateRequestId) return;
        renderWorkspace({ status: 'error', hasQuery: true, aggregates: [], error: error.message }, years, state, dispatch);
      });
  };
}

/* ---------- 头部统计数字 ---------- */
function initStats(repository, metadata) {
  data.uniqueMajors();
  $('stat-spec').textContent = String(data.MAPPING.length);
  $('stat-major').textContent = String(data.ALL_MAJORS.length);
  $('stat-score').textContent = '–';
  $('stat-school').textContent = '–';
  $('stat-plan').textContent = '–';
  var latestYear = getLatestYear(metadata);
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
    $('stat-score').textContent = '暂不可用';
    $('stat-school').textContent = '暂不可用';
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
    statsContext.controller.getState(), data.getMappingByYear(statsContext.controller.getState().focusYear));
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
$('stats-edit-filters').addEventListener('click', function () {
  switchView('query');
  var panel = $('explorer').querySelector('.filter-panel');
  if (panel) panel.scrollIntoView({ block: 'start' });
});

/* ---------- 配色切换 ---------- */
function refreshChartsIfVisible() {
  if (currentView === 'stats' && statsContext) renderStatsPage(statsContext.repository, statsContext.metadata,
    statsContext.controller.getState(), data.getMappingByYear(statsContext.controller.getState().focusYear));
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
  initStats(loaded.repository, loaded.metadata);
  var renderAggregates = createAggregateRenderer(loaded);
  var explorerController = explorer.initExplorer($('explorer'), loaded.metadata, {
    exportDialog: $('export-fields-dialog'),
    exportButton: $('exportCsv'),
    onYearChange: function (state) {
      ++queryRequestId;
      var requestId = ++yearRequestId;
      loaded.repository.ensureQueryIndex(state.focusYear).then(function (mapping) {
        if (requestId !== yearRequestId || explorerController.getState().focusYear !== state.focusYear) return;
        loaded.store.queryIndexByYear[state.focusYear] = mapping;
        if ($q.value.trim()) query.doQuery($q, $hint, $result);
        else if (currentView === 'stats' && statsContext) renderStatsPage(loaded.repository, loaded.metadata,
          explorerController.getState(), mapping);
      }).catch(function (error) { if (requestId === yearRequestId) $hint.textContent = error.message; });
    },
    onFilteredResult: function (majors, state) {
      renderAggregates(majors, state, explorerController && explorerController.dispatch);
      if (currentView === 'stats' && statsContext) renderStatsPage(loaded.repository, loaded.metadata, state,
        data.getMappingByYear(state.focusYear));
    }
  });
  statsContext = { repository: loaded.repository, metadata: loaded.metadata, controller: explorerController };
  query.setResultListener(function (majors, specName) {
    var requestId = ++queryRequestId;
    ++aggregateRequestId;
    if (!majors.length) return explorer.setSearchResult([], specName);
    var state = explorerController.getState();
    var selectedYears = state.selectedYears.slice();
    var focusYear = state.focusYear;
    setResultState($result, '正在读取所选年份的统计摘要…', 'loading');
    Promise.all(selectedYears.map(function (year) {
      return loaded.metadata.yearSources[year]
        ? Promise.all([loaded.repository.ensureAnalytics(year), loaded.repository.ensureCollegeMaster(year)])
          .then(function ([analytics, colleges]) { return { analytics: analytics, college: { colleges: colleges } }; })
        : loaded.repository.ensureCollegeYear(year).then(function (source) { return { college: source }; });
    })).then(function (documents) {
      var currentState = explorerController.getState();
      if (requestId !== queryRequestId || currentState.focusYear !== focusYear ||
          currentState.selectedYears.join(',') !== selectedYears.join(',')) return;
      var analyticsByYear = {}, collegeByYear = {};
      selectedYears.forEach(function (year, index) {
        if (documents[index].analytics) analyticsByYear[year] = documents[index].analytics;
        if (documents[index].college) collegeByYear[year] = documents[index].college;
      });
      loaded.store.querySummaryStore = queryRowsFromPublishedSources(analyticsByYear, collegeByYear, selectedYears);
      data.buildIndexes(loaded.store.querySummaryStore, loaded.metadata);
      explorer.setSearchResult(majors, specName);
    }).catch(function (error) {
      if (requestId !== queryRequestId) return;
      explorer.setSearchResult([], specName);
      setResultState($result, error.message, 'error');
    });
  });
  var initialFocusYear = explorerController.getState().focusYear;
  var initialYearRequestId = ++yearRequestId;
  loaded.repository.ensureQueryIndex(initialFocusYear).then(function (mapping) {
    if (initialYearRequestId !== yearRequestId || explorerController.getState().focusYear !== initialFocusYear) return;
    loaded.store.queryIndexByYear[initialFocusYear] = mapping;
    afterLoad();
  }).catch(function (error) { if (initialYearRequestId === yearRequestId) $hint.textContent = error.message; });
}).catch(function (err) {
  setResultState($result, '数据加载失败：' + err.message + '。请确认 metadata 配置及其声明的数据文件完整后刷新页面重试。', 'error');
  var explorerRoot = $('explorer');
  if (explorerRoot) explorerRoot.innerHTML = '<div class="msg-notfound"><b>筛选与导出不可用：</b>' + esc(err.message) + '</div>';
  $hint.textContent = '';
});

var initial = (location.hash || '').replace('#', '');
if (VIEWS.indexOf(initial) === -1) initial = 'query';
switchView(initial);
