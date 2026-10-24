import { getCollegesByYear, getScore } from './data.js';
import { enumOptions, getSortedYears } from './metadata.js';
import { createInitialState, reduceExplorerState, sanitizeNumberInput } from './explorer-state.js';
import { buildPreviewRows, sortPreviewRows } from './pipeline.js';
import { EXPLORER_STATE_KEY, clearUiPreferences, readColumnWidths, writeColumnWidths, readExplorerState, writeExplorerState } from './preferences.js';
import { setQueryYear } from './query.js';
import { resetTheme } from './theme.js';
import { esc } from './utils.js';
import { buildYearDialogHtml } from './results-view.js';
import { setResultState } from './results-controller.js';
import { bindExportDialog } from './export-dialog.js';
import { downloadCsv, prepareExport } from './export.js';

var activeExplorer = null;

export { createInitialState, reduceExplorerState, sanitizeNumberInput, canExport } from './explorer-state.js';

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

export function buildExplorerControlsHtml(metadata, state) {
  var unavailable = state.status !== 'ready' || !state.majors.length;
  var years = getSortedYears(metadata);
  var selectedYears = state.selectedYears || years;
  var yearLabel = selectedYears.length === years.length ? years[0] + '–' + years[years.length - 1] : selectedYears.join('、');
  return '<div class="explorer-status" aria-live="polite">' +
      (state.status === 'loading' ? '<span class="loading">正在加载院校数据…</span>' : '') +
      (state.status === 'error' ? '<span class="msg-notfound">' + esc(state.error) + '</span>' : '') +
    '</div>' +
    '<section class="filter-panel" aria-label="筛选条件">' +
      '<div class="filter-group"><h3>筛选条件</h3><div class="filter-row">' +
        '<div class="filter-field"><span>年份</span><button type="button" data-filter-action="years" aria-haspopup="dialog" aria-label="选择展示年份，' + esc(yearLabel) + '">' + esc(yearLabel) + '</button></div>' +
        enumControl(filterField(metadata, 'schoolType'), 'schoolType', state, unavailable) +
        enumControl(filterField(metadata, 'povertyStatus'), 'povertyStatus', state, unavailable) +
        enumControl(filterField(metadata, 'subject'), 'subject', state, unavailable) +
        minControl(filterField(metadata, 'schoolCount'), state, unavailable) +
      '</div></div>' +
      '<div class="filter-group filter-operations"><h3>筛选操作</h3><div class="filter-row">' +
      '<button type="button" data-action="reset"' + (unavailable ? ' disabled' : '') + '>重置筛选</button>' +
      '<button type="button" data-action="clear-storage"' + (state.status !== 'ready' ? ' disabled' : '') + '>清除本地存储</button>' +
      '</div></div>' + buildYearDialogHtml(metadata, selectedYears) + '</section>';
}

function renderExplorerControls(root, metadata, state, dispatch) {
  if (!root) return;
  root.innerHTML = buildExplorerControlsHtml(metadata, state);

  var yearDialog = root.querySelector('.year-selection-dialog');
  root.querySelector('[data-filter-action="years"]').addEventListener('click', function () {
    if (typeof yearDialog.showModal === 'function') yearDialog.showModal();
    else yearDialog.setAttribute('open', '');
  });
  yearDialog.querySelectorAll('[data-year-select]').forEach(function (button) {
    button.addEventListener('click', function () {
      var years = getSortedYears(metadata);
      var selected = button.dataset.yearSelect === 'latest' ? [years[years.length - 1]] : years;
      yearDialog.querySelectorAll('input[name="selected-year"]').forEach(function (input) {
        input.checked = selected.indexOf(Number(input.value)) >= 0;
      });
    });
  });
  yearDialog.querySelector('[data-year-apply]').addEventListener('click', function () {
    var selected = Array.from(yearDialog.querySelectorAll('input[name="selected-year"]:checked'))
      .map(function (input) { return Number(input.value); });
    if (!selected.length) {
      yearDialog.querySelector('.year-selection-error').textContent = '请至少选择一个年份。';
      return;
    }
    if (typeof yearDialog.close === 'function') yearDialog.close();
    else yearDialog.removeAttribute('open');
    dispatch({ type: 'SET_SELECTED_YEARS', years: selected });
  });

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
    clearUiPreferences(localStorage, metadata);
    resetTheme();
    var search = document.getElementById('q');
    var hint = document.getElementById('hint');
    var result = document.getElementById('result');
    if (search) search.value = '';
    if (hint) hint.textContent = '';
    if (result) setResultState(result, '输入专业名称，回车或点「查询」开始检索', 'empty');
    dispatch({ type: 'CLEAR_ALL', columnWidths: readColumnWidths(localStorage, metadata) });
  });
}

/* ---------- 筛选联动结果区 ----------
   把筛选后的专业（保持原顺序）通知给上层，用于重渲染专业摘要；
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

export function orderedMajorsFromRows(rows, majors) {
  return rows.map(function (row) { return majors[row.originalOrder]; });
}

function notifyFilteredResult(state, options) {
  if (typeof options.onFilteredResult !== 'function') return;
  var majors = orderedMajorsFromRows(state.rows, state.majors);
  options.onFilteredResult(majors, state, activeFilterNote(state));
}

function recompute(state, metadata) {
  if (state.status !== 'ready' || !state.majors.length) return { ...state, rows: [], effectiveSchoolCount: 0 };
  var preview = buildPreviewRows({
    majors: state.majors,
    years: state.selectedYears,
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
  state = {
    ...state,
    filters: saved.filters,
    sort: saved.sort,
    selectedYears: saved.selectedYears,
    focusYear: saved.selectedYears[saved.selectedYears.length - 1] || state.focusYear,
    resultLayout: saved.resultLayout
  };
  setQueryYear(state.focusYear);
  function dispatch(event) {
    state = reduceExplorerState(state, event, metadata);
    if (event.type === 'SET_SELECTED_YEARS') {
      setQueryYear(state.focusYear);
      if (typeof options.onYearChange === 'function') options.onYearChange(state);
    }
    if (event.type === 'SET_COLUMN_WIDTH') writeColumnWidths(localStorage, state.columnWidths);
    if (event.type === 'SET_FILTER' || event.type === 'SET_SORT' || event.type === 'RESET_FILTERS' ||
        event.type === 'SET_SELECTED_YEARS' || event.type === 'SET_RESULT_LAYOUT') {
      writeExplorerState(localStorage, state);
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
  bindExportDialog(
    options.exportDialog || document.getElementById('export-fields-dialog'),
    options.exportButton || document.getElementById('exportCsv'),
    metadata,
    function () { return state; },
    function (selectedFieldKeys) {
      var exportModel = prepareExport({ status: state.status, allRows: state.rows, selectedYears: state.selectedYears },
        metadata, state.focusYear, selectedFieldKeys);
      downloadCsv({ ...exportModel, date: new Date() });
    }
  );
  renderExplorerControls(root, metadata, state, dispatch);
  notifyFilteredResult(state, options);
  return activeExplorer;
}

export function setSearchResult(majors, specName) {
  if (activeExplorer) activeExplorer.dispatch({ type: 'SET_SEARCH_RESULT', majors: majors, specName: specName });
}
