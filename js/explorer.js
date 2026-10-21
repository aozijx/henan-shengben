import { getCollegesByYear, getScore } from './data.js';
import { enumOptions, filterDefaultValue } from './metadata.js';
import { buildPreviewRows, sortPreviewRows } from './pipeline.js';
import { renderPreview } from './preview.js';
import { downloadCsv, getExportFields } from './export.js';
import { EXPLORER_STATE_KEY, clearPreferences, readColumnWidths, writeColumnWidths, readExplorerState, writeExplorerState } from './preferences.js';
import { resetTheme } from './theme.js';
import { esc } from './utils.js';

var activeExplorer = null;

function defaultFilters(metadata) {
  var filters = {};
  (metadata.fields || []).forEach(function (field) {
    if (!field.filterEnable) return;
    filters[field.key] = filterDefaultValue(field);
  });
  return filters;
}

export function createInitialState(metadata) {
  return {
    status: 'loading',
    error: '',
    year: metadata.defaultYear,
    majors: [],
    specName: '',
    filters: defaultFilters(metadata),
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
  if (event.type === 'SET_FILTER') {
    return { ...state, filters: { ...state.filters, [event.key]: event.value }, page: 1 };
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
      page: 1
    };
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

function filterField(metadata, key) {
  return metadata.fields.find(function (field) { return field.key === key && field.filterEnable; });
}

function enumControl(field, stateKey, state, disabled) {
  if (!field) return '';
  var options = enumOptions(field).map(function (value) {
    return '<option value="' + esc(value) + '"' + (state.filters[stateKey] === value ? ' selected' : '') + '>' + esc(value) + '</option>';
  }).join('');
  return '<label class="filter-field"><span>' + esc(field.label) + '</span>' +
    '<select data-filter="' + stateKey + '"' + (disabled ? ' disabled' : '') + '>' + options + '</select></label>';
}

function minControl(field, state, disabled) {
  if (!field) return '';
  var value = state.filters[field.key] || '';
  return '<label class="filter-field"><span>' + esc(field.label) + ' &gt;</span>' +
    '<input data-filter-number="' + esc(field.key) + '" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="不限" value="' + esc(value) + '"' +
    (disabled ? ' disabled' : '') + '></label>';
}

function renderExplorerControls(root, metadata, state, dispatch) {
  if (!root) return;
  var unavailable = state.status !== 'ready' || !state.majors.length;

  root.innerHTML =
    '<div class="explorer-status" aria-live="polite">' +
      (state.status === 'loading' ? '<span class="loading">正在加载院校数据…</span>' : '') +
      (state.status === 'error' ? '<span class="msg-notfound">' + esc(state.error) + '</span>' : '') +
    '</div>' +
    '<section class="filter-panel" aria-label="筛选条件">' +
      '<div class="filter-group"><h3>筛选条件</h3><div class="filter-row">' +
        enumControl(filterField(metadata, 'schoolType'), 'schoolType', state, unavailable) +
        enumControl(filterField(metadata, 'povertyStatus'), 'povertyStatus', state, unavailable) +
        enumControl(filterField(metadata, 'subject'), 'subject', state, unavailable) +
        minControl(filterField(metadata, 'schoolCount'), state, unavailable) +
      '</div></div>' +
    '</section>' +
    '<section class="explorer-actions" aria-label="操作按钮">' +
      '<button type="button" data-action="reset"' + (unavailable ? ' disabled' : '') + '>重置筛选</button>' +
      '<button type="button" data-action="clear-storage"' + (state.status !== 'ready' ? ' disabled' : '') + '>清除本地存储</button>' +
    '</section>' +
    '<section class="preview-section"><div id="preview-table" class="preview-placeholder" aria-live="polite">' +
      (state.majors.length ? '预览表格准备中…' : '请先查询专科专业，再使用筛选与导出。') +
    '</div></section>' +
    '<section class="export-actions"><button type="button" id="exportCsv"' +
      (!canExport(state) ? ' disabled' : '') + '>导出 CSV</button></section>';

  root.querySelectorAll('[data-filter]').forEach(function (control) {
    control.addEventListener('change', function () { dispatch({ type: 'SET_FILTER', key: control.dataset.filter, value: control.value }); });
  });
  root.querySelectorAll('[data-filter-number]').forEach(function (control) {
    control.addEventListener('input', function () {
      var clean = sanitizeNumberInput(control.value);
      if (control.value !== clean) control.value = clean;
      dispatch({ type: 'SET_FILTER', key: control.dataset.filterNumber, value: clean });
    });
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
    sort: state.sort,
    effectiveSchoolCount: state.effectiveSchoolCount,
    effectiveSchoolYear: latestSupportedYear(metadata),
    hasSearch: state.majors.length > 0,
    status: state.status,
    error: state.error,
    columnWidths: state.columnWidths
  }, metadata, dispatch);
}

function latestSupportedYear(metadata) {
  var years = metadata.supportedYears || [];
  return years.length ? Math.max.apply(null, years) : null;
}

/* ---------- 筛选联动结果区 ----------
   把筛选后的专业（保持原顺序）通知给上层，用于重渲染查询结果表；
   同时返回「筛选后 X / Y 个专业」的计数说明（未启用筛选时为 null）。 */
function activeFilterNote(state) {
  var f = state.filters || {};
  var active = (f.schoolType && f.schoolType !== '全部') ||
    (f.povertyStatus && f.povertyStatus !== '全部') ||
    (f.subject && f.subject !== '全部') ||
    (f.schoolCount != null && f.schoolCount !== '');
  if (!active) return null;
  return '筛选后 ' + state.rows.length + ' / ' + state.majors.length + ' 个专业';
}

function notifyFilteredResult(state, options) {
  if (typeof options.onFilteredResult !== 'function') return;
  var majors = state.rows.slice()
    .sort(function (a, b) { return a.originalOrder - b.originalOrder; })
    .map(function (row) { return state.majors[row.originalOrder]; });
  options.onFilteredResult(majors, activeFilterNote(state));
}

function recompute(state, metadata) {
  if (state.status !== 'ready' || !state.majors.length) return { ...state, rows: [], effectiveSchoolCount: 0 };
  var preview = buildPreviewRows({
    majors: state.majors,
    years: metadata.supportedYears,
    filters: state.filters,
    getScore: function (major, year) { return getScore(major, year); },
    getPlans: function (major, year) { return getCollegesByYear(year, major); }
  });
  return {
    ...state,
    rows: sortPreviewRows(preview.rows, state.sort),
    effectiveSchoolCount: preview.effectiveSchoolCount
  };
}

export function initExplorer(root, metadata, options) {
  options = options || {};
  var state = reduceExplorerState(createInitialState(metadata), { type: 'LOAD_SUCCESS' }, metadata);
  state = { ...state, columnWidths: readColumnWidths(localStorage, metadata) };
  var saved = readExplorerState(localStorage, metadata);
  state = { ...state, filters: saved.filters, sort: saved.sort };
  function dispatch(event) {
    state = reduceExplorerState(state, event, metadata);
    if (event.type === 'SET_COLUMN_WIDTH') writeColumnWidths(localStorage, state.columnWidths);
    if (event.type === 'SET_FILTER' || event.type === 'SET_SORT' || event.type === 'RESET_FILTERS') {
      writeExplorerState(localStorage, state.filters, state.sort);
    }
    if (event.type === 'CLEAR_ALL') localStorage.removeItem(EXPLORER_STATE_KEY);
    state = recompute(state, metadata);
    renderExplorerControls(root, metadata, state, dispatch);
    notifyFilteredResult(state, options);
  }
  activeExplorer = {
    dispatch: dispatch,
    getState: function () { return state; }
  };
  renderExplorerControls(root, metadata, state, dispatch);
  notifyFilteredResult(state, options);
  return activeExplorer;
}

export function setSearchResult(majors, specName) {
  if (activeExplorer) activeExplorer.dispatch({ type: 'SET_SEARCH_RESULT', majors: majors, specName: specName });
}
