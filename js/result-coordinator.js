/* Async coordination between query/filter state, published summaries, and result views. */
import { normalizeCollegeMasterRow, normalizeMajorOption, normalizePlanEntry, normalizeScoreSegmentSeries } from './model.js';
import { buildMajorAggregates, resolveScoreContext } from './aggregate.js';
import { buildResultModel, filterYear } from './result-model.js';
import { buildExpandedMajorHtml } from './results-view.js';
import { renderResultWorkspace, setResultState } from './results-controller.js';
import { lookupScoreSegmentCode } from './score-curves.js';
import { queryRowsFromPublishedSources } from './analytics-query.js';
import { getSortedYears } from './metadata.js';

export function createResultCoordinator(options) {
  var metadata = options.metadata;
  var repository = options.repository;
  var data = options.data;
  var resultRoot = options.resultRoot;
  var queryInput = options.queryInput;
  var hint = options.hint;
  var getState = options.getState;
  var getDispatch = options.getDispatch;
  var isStatsVisible = options.isStatsVisible;
  var renderStats = options.renderStats;
  var setQueryYear = options.setQueryYear;
  var runSearch = options.runSearch;
  var queryRequestId = 0;
  var yearRequestId = 0;
  var aggregateRequestId = 0;
  var summaryStore = null;

  function renderWorkspace(view, years, state, onExpand) {
    renderResultWorkspace(resultRoot, {
      ...view,
      selectedYears: years,
      resultLayout: state && state.resultLayout,
      filters: state && state.filters,
      sort: state && state.sort
    }, metadata, getDispatch(), onExpand);
  }

  function renderAggregates(state) {
    var majors = state.rows.map(function (row) { return state.majors[row.originalOrder]; });
    var years = (state && state.selectedYears) || getSortedYears(metadata);
    var requestId = ++aggregateRequestId;
    if (!majors.length) {
      renderWorkspace({ status: 'ready', hasQuery: Boolean(state && state.specName), aggregates: [] }, years, state);
      return;
    }
    renderWorkspace({ status: 'loading', hasQuery: true, aggregates: [] }, years, state);
    Promise.resolve().then(function () {
      if (requestId !== aggregateRequestId) return;
      var source = summaryStore || { plansByYear: {}, scoresByYear: {}, fallbacksByYear: {} };
      var aggregates = buildMajorAggregates({
        majors: majors.map(function (major) {
          return normalizeMajorOption(major, metadata.derivedFields && metadata.derivedFields.publicCourse);
        }),
        years: years,
        plansByYear: Object.fromEntries(years.map(function (year) {
          return [year, (source.plansByYear[year] || []).map(normalizePlanEntry)];
        })),
        planPublishedByYear: source.planPublishedByYear,
        scorePublishedByYear: source.scorePublishedByYear,
        scoresByYear: source.scoresByYear,
        fallbacksByYear: source.fallbacksByYear
      });
      var resultModel = buildResultModel({ aggregates: aggregates, metadata: metadata,
        selectedYears: years, filters: state.filters, sort: state.sort });
      if (requestId !== aggregateRequestId) return;
      renderWorkspace({ status: 'ready', hasQuery: true, aggregates: resultModel.aggregates }, years, state,
        function (aggregate, selected, hiddenFields, schoolYears) {
          var detailYears = schoolYears || selected;
          return Promise.all([Promise.all(selected.map(function (year) {
            if (!metadata.yearSources[year]) return Promise.resolve(null);
            return repository.ensureScoreSegmentIndex(year).then(function (index) {
              var code = lookupScoreSegmentCode(index, aggregate.major.majorCode);
              return code ? repository.ensureScoreSegment(year, code) : null;
            });
          })), Promise.all(detailYears.map(function (year) {
            return data.ensureYear(year);
          }))]).then(function (values) {
            var detail = { ...aggregate, years: { ...aggregate.years } };
            var input = { majors: [aggregate.major], years: detailYears,
              plansByYear: {}, scoresByYear: {}, planPublishedByYear: {},
              scorePublishedByYear: {}, fallbacksByYear: {} };
            detailYears.forEach(function (year, index) {
              var yearData = values[1][index];
              input.plansByYear[year] = yearData.plans.map(normalizePlanEntry);
              input.scoresByYear[year] = yearData.scores;
              input.planPublishedByYear[year] = yearData.planPublished;
              input.scorePublishedByYear[year] = yearData.scorePublished;
              input.fallbacksByYear[year] = yearData.colleges.map(function (row) {
                return normalizeCollegeMasterRow(row, yearData.planPublished);
              });
            });
            var loadedDetail = buildMajorAggregates(input)[0];
            detailYears.forEach(function (year) {
              detail.years[year] = filterYear(loadedDetail.years[year], state.filters || {}, metadata);
            });
            selected.forEach(function (year, index) {
              var yearValue = detail.years[year];
              if (!yearValue) return;
              var series = values[0][index] ? normalizeScoreSegmentSeries(values[0][index]) : null;
              detail.years[year] = { ...yearValue, scoreSegments: series,
                scoreContext: resolveScoreContext(series, null, yearValue.score) };
            });
            return { html: buildExpandedMajorHtml(detail, selected, hiddenFields, schoolYears) };
          }).catch(function (error) { return { error: error.message }; });
        });
    }).catch(function (error) {
      if (requestId !== aggregateRequestId) return;
      renderWorkspace({ status: 'error', hasQuery: true, aggregates: [], error: error.message }, years, state);
    });
  }

  function onQueryResult(majors, specialtyName) {
    var requestId = ++queryRequestId;
    ++aggregateRequestId;
    if (!majors.length) {
      getDispatch()({ type: 'SET_SEARCH_RESULT', majors: [], specName: specialtyName });
      return;
    }
    var state = getState();
    var selectedYears = state.selectedYears.slice();
    var focusYear = state.focusYear;
    setResultState(resultRoot, '正在读取所选年份的统计摘要…', 'loading');
    Promise.all(selectedYears.map(function (year) {
      return metadata.yearSources[year]
        ? Promise.all([repository.ensureAnalytics(year), repository.ensureCollegeMaster(year)])
          .then(function (values) { return { analytics: values[0], college: { colleges: values[1] } }; })
        : repository.ensureCollegeYear(year).then(function (source) { return { college: source }; });
    })).then(function (documents) {
      var currentState = getState();
      if (requestId !== queryRequestId || currentState.focusYear !== focusYear ||
          currentState.selectedYears.join(',') !== selectedYears.join(',')) return;
      var analyticsByYear = {}, collegeByYear = {};
      selectedYears.forEach(function (year, index) {
        if (documents[index].analytics) analyticsByYear[year] = documents[index].analytics;
        if (documents[index].college) collegeByYear[year] = documents[index].college;
      });
      summaryStore = queryRowsFromPublishedSources(analyticsByYear, collegeByYear, selectedYears);
      data.setSummaryStore(summaryStore);
      getDispatch()({ type: 'SET_SEARCH_RESULT', majors: majors, specName: specialtyName });
    }).catch(function (error) {
      if (requestId !== queryRequestId) return;
      getDispatch()({ type: 'SET_SEARCH_RESULT', majors: [], specName: specialtyName });
      setResultState(resultRoot, error.message, 'error');
    });
  }

  function onYearChange(state) {
    ++queryRequestId;
    var requestId = ++yearRequestId;
    if (typeof setQueryYear === 'function') setQueryYear(state.focusYear);
    data.ensureQueryIndex(state.focusYear).then(function (mapping) {
      var currentState = getState();
      if (requestId !== yearRequestId || currentState.focusYear !== state.focusYear ||
          currentState.selectedYears.join(',') !== state.selectedYears.join(',')) return;
      if (queryInput.value.trim()) runSearch();
      else if (isStatsVisible()) renderStats(currentState, mapping);
    }).catch(function (error) {
      if (requestId === yearRequestId) hint.textContent = error.message;
    });
  }

  function onStateChange(state, action) {
    if (action && action.type === 'CLEAR_ALL') {
      ++queryRequestId;
      ++aggregateRequestId;
      summaryStore = null;
    }
    renderAggregates(state);
    if (isStatsVisible() && data.hasQueryIndex(state.focusYear)) renderStats(state, data.getMapping(state.focusYear));
    if (action && action.type === 'SET_SELECTED_YEARS') onYearChange(state);
  }

  return {
    onQueryResult: onQueryResult,
    onStateChange: onStateChange,
    refreshStats: function () {
      var state = getState();
      if (state && isStatsVisible()) renderStats(state, data.getMapping(state.focusYear));
    },
    start: function (year) {
      var requestId = ++yearRequestId;
      if (typeof setQueryYear === 'function') setQueryYear(year);
      data.ensureQueryIndex(year).then(function (mapping) {
        if (requestId !== yearRequestId || getState().focusYear !== year) return;
        if (queryInput.value.trim()) runSearch();
        else if (isStatsVisible()) renderStats(getState(), mapping);
      }).catch(function (error) { if (requestId === yearRequestId) hint.textContent = error.message; });
    }
  };
}
