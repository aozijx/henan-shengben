import { filterDefaultValue, getFocusYear, normalizeSelectedYears } from './metadata.js';

function defaultFilters(metadata) {
  var filters = {};
  (metadata.fields || []).forEach(function (field) {
    if (field.filterEnable) filters[field.key] = filterDefaultValue(field);
  });
  return filters;
}

export function createInitialState(metadata) {
  var selectedYears = normalizeSelectedYears(null, metadata);
  var uiDefaults = metadata.uiDefaults || {};
  return {
    status: 'loading', error: '', year: metadata.defaultYear,
    selectedYears: selectedYears,
    focusYear: getFocusYear(selectedYears, metadata),
    resultLayout: uiDefaults.resultLayout === 'table' ? 'table' : 'cards',
    majors: [], specName: '', filters: defaultFilters(metadata),
    sort: { key: metadata.defaultSort.key, direction: metadata.defaultSort.direction },
    page: 1, rows: [], effectiveSchoolCount: 0, columnWidths: {}
  };
}

export function reduceExplorerState(state, event, metadata) {
  if (event.type === 'LOAD_SUCCESS') return { ...state, status: 'ready', error: '' };
  if (event.type === 'LOAD_ERROR') return { ...state, status: 'error', error: event.error || '加载失败' };
  if (event.type === 'SET_FILTER') return { ...state, filters: { ...state.filters, [event.key]: event.value }, page: 1 };
  if (event.type === 'SET_SORT') return { ...state, sort: { ...event.sort }, page: 1 };
  if (event.type === 'SET_SELECTED_YEARS') {
    var selectedYears = normalizeSelectedYears(event.years, metadata);
    if (!selectedYears.length) return state;
    return { ...state, selectedYears: selectedYears, focusYear: getFocusYear(selectedYears, metadata), year: getFocusYear(selectedYears, metadata), page: 1 };
  }
  if (event.type === 'SET_RESULT_LAYOUT') {
    if (event.resultLayout !== 'cards' && event.resultLayout !== 'table') return state;
    return { ...state, resultLayout: event.resultLayout };
  }
  if (event.type === 'SET_PAGE') return { ...state, page: Math.max(1, Number(event.page) || 1) };
  if (event.type === 'SET_COLUMN_WIDTH') {
    return { ...state, columnWidths: { ...state.columnWidths, [event.key]: Number(event.width) } };
  }
  if (event.type === 'SET_SEARCH_RESULT') {
    return { ...state, majors: Array.isArray(event.majors) ? event.majors.slice() : [], specName: event.specName || '', page: 1 };
  }
  if (event.type === 'RESET_FILTERS') {
    return {
      ...state,
      filters: defaultFilters(metadata),
      sort: { key: metadata.defaultSort.key, direction: metadata.defaultSort.direction },
      page: 1
    };
  }
  if (event.type === 'CLEAR_ALL') {
    return { ...createInitialState(metadata), status: 'ready', columnWidths: event.columnWidths || {} };
  }
  return state;
}

export function sanitizeNumberInput(value) {
  return String(value == null ? '' : value).replace(/\D+/g, '');
}

export function canExport(state) {
  return state.status === 'ready' && Array.isArray(state.rows) && state.rows.length > 0;
}
