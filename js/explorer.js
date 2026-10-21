import { getCollegesByYear, getScore } from './data.js';
import { buildPreviewRows, sortPreviewRows, validateScoreRange } from './pipeline.js';
import { renderPreview } from './preview.js';
import { downloadCsv, getExportFields } from './export.js';
import { clearPreferences, readColumnWidths, writeColumnWidths } from './preferences.js';
import { resetTheme } from './theme.js';
import { esc } from './utils.js';

var activeExplorer = null;

function defaultFilters() {
  return { schoolType: '全部', povertyStatus: '全部', minScore: '', maxScore: '' };
}

export function createInitialState(metadata) {
  return {
    status: 'loading',
    error: '',
    validationError: '',
    year: metadata.defaultYear,
    majors: [],
    specName: '',
    filters: defaultFilters(),
    sort: { key: metadata.defaultSort.key, direction: metadata.defaultSort.direction },
    page: 1,
    rows: [],
    effectiveSchoolCount: 0,
    columnWidths: {}
  };
}

export function reduceExplorerState(state, event, metadata) {
  if (event.type === 'LOAD_SUCCESS') return { ...state, status: 'ready', error: '' };
  if (event.type === 'LOAD_ERROR') return { ...state, status: 'error', error: event.error || '加载失败' };
  if (event.type === 'SET_YEAR') return { ...state, year: Number(event.year), page: 1, validationError: '' };
  if (event.type === 'SET_FILTER') {
    return { ...state, filters: { ...state.filters, [event.key]: event.value }, page: 1, validationError: '' };
  }
  if (event.type === 'SET_SORT') return { ...state, sort: { ...event.sort }, page: 1 };
  if (event.type === 'SET_PAGE') return { ...state, page: Math.max(1, Number(event.page) || 1) };
  if (event.type === 'SET_COLUMN_WIDTH') {
    return { ...state, columnWidths: { ...state.columnWidths, [event.key]: Number(event.width) } };
  }
  if (event.type === 'SET_SEARCH_RESULT') {
    return {
      ...state,
      majors: Array.isArray(event.majors) ? event.majors.slice() : [],
      specName: event.specName || '',
      page: 1,
      validationError: ''
    };
  }
  if (event.type === 'RESET_FILTERS') {
    return {
      ...state,
      filters: defaultFilters(),
      sort: { key: metadata.defaultSort.key, direction: metadata.defaultSort.direction },
      page: 1,
      validationError: ''
    };
  }
  if (event.type === 'CLEAR_ALL') {
    return { ...createInitialState(metadata), status: 'ready', columnWidths: event.columnWidths || {} };
  }
  return state;
}

export function sanitizeScoreInput(value) {
  return String(value == null ? '' : value).replace(/\D+/g, '');
}

export function canExport(state) {
  return state.status === 'ready' && Array.isArray(state.rows) && state.rows.length > 0 && !state.validationError;
}

function filterField(metadata, key) {
  return metadata.fields.find(function (field) { return field.key === key && field.filterEnable; });
}

function enumControl(field, stateKey, state, disabled) {
  if (!field) return '';
  var options = ['全部'].concat(field.enumValues || []).map(function (value) {
    return '<option value="' + esc(value) + '"' + (state.filters[stateKey] === value ? ' selected' : '') + '>' + esc(value) + '</option>';
  }).join('');
  return '<label class="filter-field"><span>' + esc(field.label) + '</span>' +
    '<select data-filter="' + stateKey + '"' + (disabled ? ' disabled' : '') + '>' + options + '</select></label>';
}

function sortOptions(metadata, selected) {
  var output = [];
  metadata.fields.filter(function (field) { return field.sortEnable; }).forEach(function (field) {
    if (field.key === 'originalOrder') {
      output.push({ value: field.key + ':original', label: field.label });
    } else {
      output.push({ value: field.key + ':desc', label: field.label + '：从高到低' });
      output.push({ value: field.key + ':asc', label: field.label + '：从低到高' });
    }
  });
  return output.map(function (option) {
    return '<option value="' + esc(option.value) + '"' + (option.value === selected ? ' selected' : '') + '>' + esc(option.label) + '</option>';
  }).join('');
}

export function renderExplorerControls(root, metadata, state, dispatch) {
  if (!root) return;
  var unavailable = state.status !== 'ready' || !state.majors.length;
  var score = filterField(metadata, 'score') || {};
  var yearOptions = metadata.supportedYears.map(function (year) {
    return '<option value="' + year + '"' + (state.year === year ? ' selected' : '') + '>' + year + ' 年</option>';
  }).join('');
  var presets = (metadata.scorePresets || []).map(function (preset) {
    return '<button type="button" class="score-preset" data-min="' + preset.min + '" data-max="' + preset.max + '"' +
      (unavailable ? ' disabled' : '') + '>' + esc(preset.label) + '</button>';
  }).join('');
  var selectedSort = state.sort.key + ':' + state.sort.direction;

  root.innerHTML =
    '<div class="explorer-status" aria-live="polite">' +
      (state.status === 'loading' ? '<span class="loading">正在加载院校数据…</span>' : '') +
      (state.status === 'error' ? '<span class="msg-notfound">' + esc(state.error) + '</span>' : '') +
    '</div>' +
    '<section class="filter-panel" aria-label="筛选条件">' +
      '<div class="filter-group"><h3>基础属性筛选</h3><div class="filter-row">' +
        '<label class="filter-field"><span>数据年份</span><select data-year' + (state.status !== 'ready' ? ' disabled' : '') + '>' + yearOptions + '</select></label>' +
        enumControl(filterField(metadata, 'schoolType'), 'schoolType', state, unavailable) +
        enumControl(filterField(metadata, 'povertyStatus'), 'povertyStatus', state, unavailable) +
      '</div></div>' +
      '<div class="filter-group"><h3>分数区间筛选</h3><div class="filter-row score-range">' +
        '<label class="filter-field"><span>最低分</span><input data-score="minScore" type="text" inputmode="numeric" pattern="[0-9]*" min="' + (score.min ?? 0) + '" max="' + (score.max ?? '') + '" value="' + esc(state.filters.minScore) + '"' + (unavailable ? ' disabled' : '') + '></label>' +
        '<label class="filter-field"><span>最高分</span><input data-score="maxScore" type="text" inputmode="numeric" pattern="[0-9]*" min="' + (score.min ?? 0) + '" max="' + (score.max ?? '') + '" value="' + esc(state.filters.maxScore) + '"' + (unavailable ? ' disabled' : '') + '></label>' +
        '<div class="score-presets" aria-label="快速分数档位">' + presets + '</div>' +
      '</div><p class="field-error" id="scoreError">' + esc(state.validationError) + '</p></div>' +
    '</section>' +
    '<section class="sort-panel" aria-label="排序控制"><label class="filter-field"><span>排序方式</span>' +
      '<select data-sort' + (unavailable ? ' disabled' : '') + '>' + sortOptions(metadata, selectedSort) + '</select></label></section>' +
    '<section class="explorer-actions" aria-label="操作按钮">' +
      '<button type="button" data-action="reset"' + (unavailable ? ' disabled' : '') + '>重置筛选</button>' +
      '<button type="button" data-action="clear-storage"' + (state.status !== 'ready' ? ' disabled' : '') + '>清除本地存储</button>' +
    '</section>' +
    '<section class="preview-section"><div id="preview-table" class="preview-placeholder" aria-live="polite">' +
      (state.majors.length ? '预览表格准备中…' : '请先查询专科专业，再使用筛选与导出。') +
    '</div></section>' +
    '<section class="export-actions"><button type="button" id="exportCsv"' +
      (!canExport(state) ? ' disabled' : '') + '>导出 CSV</button></section>';

  var yearSelect = root.querySelector('[data-year]');
  if (yearSelect) yearSelect.addEventListener('change', function () { dispatch({ type: 'SET_YEAR', year: yearSelect.value }); });
  root.querySelectorAll('[data-filter]').forEach(function (control) {
    control.addEventListener('change', function () { dispatch({ type: 'SET_FILTER', key: control.dataset.filter, value: control.value }); });
  });
  root.querySelectorAll('[data-score]').forEach(function (control) {
    control.addEventListener('input', function () {
      var clean = sanitizeScoreInput(control.value);
      if (control.value !== clean) control.value = clean;
      dispatch({ type: 'SET_FILTER', key: control.dataset.score, value: clean });
    });
  });
  root.querySelectorAll('.score-preset').forEach(function (button) {
    button.addEventListener('click', function () {
      dispatch({ type: 'SET_FILTER', key: 'minScore', value: button.dataset.min });
      dispatch({ type: 'SET_FILTER', key: 'maxScore', value: button.dataset.max });
    });
  });
  var sortSelect = root.querySelector('[data-sort]');
  if (sortSelect) sortSelect.addEventListener('change', function () {
    var parts = sortSelect.value.split(':');
    dispatch({ type: 'SET_SORT', sort: { key: parts[0], direction: parts[1] } });
  });
  var reset = root.querySelector('[data-action="reset"]');
  if (reset) reset.addEventListener('click', function () { dispatch({ type: 'RESET_FILTERS' }); });
  var clearStorage = root.querySelector('[data-action="clear-storage"]');
  if (clearStorage) clearStorage.addEventListener('click', function () {
    clearPreferences(localStorage);
    resetTheme();
    var search = document.getElementById('q');
    var hint = document.getElementById('hint');
    var result = document.getElementById('result');
    if (search) search.value = '';
    if (hint) hint.textContent = '';
    if (result) result.innerHTML = '<div class="empty">输入专业名称，回车或点「查询」开始检索</div>';
    dispatch({ type: 'CLEAR_ALL', columnWidths: readColumnWidths(localStorage, metadata) });
  });
  var exportButton = root.querySelector('#exportCsv');
  if (exportButton) exportButton.addEventListener('click', function () {
    downloadCsv({ rows: state.rows, fields: getExportFields(metadata), year: state.year, date: new Date() });
  });
  renderPreview(root.querySelector('#preview-table'), {
    rows: state.rows,
    page: state.page,
    effectiveSchoolCount: state.effectiveSchoolCount,
    hasSearch: state.majors.length > 0,
    status: state.status,
    error: state.error,
    columnWidths: state.columnWidths
  }, metadata, dispatch);
}

function recompute(state, metadata) {
  if (state.status !== 'ready' || !state.majors.length) return { ...state, rows: [], effectiveSchoolCount: 0 };
  var validation = validateScoreRange(state.filters, metadata);
  if (!validation.valid) return { ...state, validationError: validation.error };
  var preview = buildPreviewRows({
    majors: state.majors,
    year: state.year,
    filters: state.filters,
    metadata: metadata,
    getScore: function (major, year) { return getScore(major, year); },
    getPlans: function (major, year) { return getCollegesByYear(year, major); }
  });
  return {
    ...state,
    validationError: '',
    rows: sortPreviewRows(preview.rows, state.sort),
    effectiveSchoolCount: preview.effectiveSchoolCount
  };
}

export function initExplorer(root, metadata, options) {
  options = options || {};
  var state = reduceExplorerState(createInitialState(metadata), { type: 'LOAD_SUCCESS' }, metadata);
  state = { ...state, columnWidths: readColumnWidths(localStorage, metadata) };
  function dispatch(event) {
    var previousYear = state.year;
    state = reduceExplorerState(state, event, metadata);
    if (event.type === 'SET_COLUMN_WIDTH') writeColumnWidths(localStorage, state.columnWidths);
    state = recompute(state, metadata);
    renderExplorerControls(root, metadata, state, dispatch);
    if (state.year !== previousYear && typeof options.onYearChange === 'function') options.onYearChange(state.year);
  }
  activeExplorer = {
    dispatch: dispatch,
    getState: function () { return state; }
  };
  renderExplorerControls(root, metadata, state, dispatch);
  if (typeof options.onYearChange === 'function') options.onYearChange(state.year);
  return activeExplorer;
}

export function setSearchResult(majors, specName) {
  if (activeExplorer) activeExplorer.dispatch({ type: 'SET_SEARCH_RESULT', majors: majors, specName: specName });
}
