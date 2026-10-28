import { enumOptions, getSelectableYears } from './metadata.js';
import { createInitialState, reduceExplorerState, sanitizeNumberInput } from './explorer-state.js';
import { buildPreviewRows, sortPreviewRows } from './pipeline.js';
import { EXPLORER_STATE_KEY, clearUiPreferences, readColumnWidths, writeColumnWidths, readExplorerState, writeExplorerState } from './preferences.js';
import { resetTheme } from './theme.js';
import { esc } from './utils.js';
import { buildYearDialogHtml } from './results-view.js';
import { bindExportDialog } from './export-dialog.js';
import { downloadCsv, prepareExport } from './export.js';

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
  return '<label class="filter-field filter-field-number"><span>' + esc(field.label) + ' &gt;</span>' +
    '<input data-filter-number="' + esc(field.key) + '" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="不限" value="' + esc(value) + '"' +
    (disabled ? ' disabled' : '') + '></label>';
}

export function buildExplorerControlsHtml(metadata, state) {
  var unavailable = state.status !== 'ready' || !state.majors.length;
  var years = getSelectableYears(metadata);
  var selectedYears = state.selectedYears || years;
  var yearLabel = selectedYears.length >= 3
    ? selectedYears[0] + '–' + selectedYears[selectedYears.length - 1]
    : selectedYears.join('、');
  var fullYearLabel = selectedYears.join('、');
  return '<div class="explorer-status" aria-live="polite">' +
      (state.status === 'loading' ? '<span class="loading">正在加载院校数据…</span>' : '') +
      (state.status === 'error' ? '<span class="msg-notfound">' + esc(state.error) + '</span>' : '') +
    '</div>' +
    '<section class="filter-panel" aria-label="筛选条件">' +
      '<div class="filter-group"><h3>筛选条件</h3><div class="filter-row">' +
        '<div class="filter-field"><span>年份</span><button type="button" data-filter-action="years" aria-haspopup="dialog" aria-label="选择展示年份，当前已选 ' + esc(fullYearLabel) + '">' + esc(yearLabel) + '</button></div>' +
        metadata.fields.filter(function (field) { return field.filterEnable && field.type === 'enum'; })
          .map(function (field) { return enumControl(field, field.key, state, unavailable); }).join('') +
        minControl(filterField(metadata, 'schoolCount'), state, unavailable) +
      '</div></div>' +
      '<div class="filter-group filter-operations"><h3>筛选操作</h3><div class="filter-row">' +
      '<button type="button" data-action="reset"' + (unavailable ? ' disabled' : '') + '>重置筛选</button>' +
      '<button type="button" data-action="clear-storage"' + (state.status !== 'ready' ? ' disabled' : '') + '>清除本地存储</button>' +
      '</div></div>' + buildYearDialogHtml(metadata, selectedYears) + '</section>';
}

function renderExplorerControls(root, metadata, state) {
  if (!root) return;
  root.innerHTML = buildExplorerControlsHtml(metadata, state);
}

function bindExplorerEvents(root, metadata, dispatch, onClear) {
  if (!root || root.dataset.eventsBound === 'true') return;
  root.addEventListener('click', function (event) {
    var target = event.target.closest('[data-filter-action], [data-year-select], [data-year-apply], [data-action]');
    if (!target || !root.contains(target)) return;
    var yearDialog = root.querySelector('.year-selection-dialog');
    if (target.matches('[data-filter-action="years"]')) {
      if (typeof yearDialog.showModal === 'function') yearDialog.showModal();
      else yearDialog.setAttribute('open', '');
    } else if (target.matches('[data-year-select]')) {
      var years = getSelectableYears(metadata);
      var selected = target.dataset.yearSelect === 'latest' ? [years[years.length - 1]] : years;
      yearDialog.querySelectorAll('input[name="selected-year"]').forEach(function (input) {
        input.checked = selected.indexOf(Number(input.value)) >= 0;
      });
    } else if (target.matches('[data-year-apply]')) {
      var selectedYears = Array.from(yearDialog.querySelectorAll('input[name="selected-year"]:checked'))
        .map(function (input) { return Number(input.value); });
      if (!selectedYears.length) {
        yearDialog.querySelector('.year-selection-error').textContent = '请至少选择一个年份。';
        return;
      }
      if (typeof yearDialog.close === 'function') yearDialog.close();
      else yearDialog.removeAttribute('open');
      dispatch({ type: 'SET_SELECTED_YEARS', years: selectedYears });
    } else if (target.matches('[data-action="reset"]')) {
      dispatch({ type: 'RESET_FILTERS' });
    } else if (target.matches('[data-action="clear-storage"]')) {
      clearUiPreferences(localStorage, metadata);
      resetTheme();
      if (typeof onClear === 'function') onClear();
      dispatch({ type: 'CLEAR_ALL', columnWidths: readColumnWidths(localStorage, metadata) });
    }
  });
  root.addEventListener('change', function (event) {
    var control = event.target;
    if (control.matches('[data-filter]')) {
      dispatch({ type: 'SET_FILTER', key: control.dataset.filter, value: control.value });
    }
  });
  root.addEventListener('input', function (event) {
    var control = event.target;
    if (!control.matches('[data-filter-number]')) return;
    var clean = sanitizeNumberInput(control.value);
    if (control.value !== clean) control.value = clean;
    dispatch({ type: 'SET_FILTER', key: control.dataset.filterNumber, value: clean });
  });
  root.dataset.eventsBound = 'true';
}

export function orderedMajorsFromRows(rows, majors) {
  return rows.map(function (row) { return majors[row.originalOrder]; });
}

function recompute(state, metadata, data) {
  if (state.status !== 'ready' || !state.majors.length) return { ...state, rows: [], effectiveSchoolCount: 0 };
  var preview = buildPreviewRows({
    metadata: metadata,
    majors: state.majors,
    years: state.selectedYears,
    filters: state.filters,
    planPublishedByYear: metadata.sourceCatalog && Object.fromEntries(state.selectedYears.map(function (year) {
      return [year, Boolean((metadata.sourceCatalog.plans || {})[year] || (metadata.yearSources || {})[year])];
    })),
    getScore: function (major, year) { return data.getScore(major, year); },
    getPlans: function (major, year) { return data.getColleges(major, year); },
    getMasters: function (major, year) { return data.getMasterRows(major, year); }
  });
  return {
    ...state,
    rows: sortPreviewRows(preview.rows, state.sort),
    effectiveSchoolCount: preview.effectiveSchoolCount
  };
}

export function initExplorer(root, metadata, options) {
  options = options || {};
  if (!options.data) throw new Error('筛选控制器需要数据上下文');
  var data = options.data;
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
  function dispatch(event) {
    var nextState = reduceExplorerState(state, event, metadata);
    if (nextState === state) return state;
    state = nextState;
    if (event.type === 'SET_COLUMN_WIDTH') writeColumnWidths(localStorage, state.columnWidths);
    if (event.type === 'SET_FILTER' || event.type === 'SET_SORT' || event.type === 'RESET_FILTERS' ||
        event.type === 'SET_SELECTED_YEARS' || event.type === 'SET_RESULT_LAYOUT') {
      writeExplorerState(localStorage, state);
    }
    if (event.type === 'CLEAR_ALL') localStorage.removeItem(EXPLORER_STATE_KEY);
    state = recompute(state, metadata, data);
    renderExplorerControls(root, metadata, state);
    if (typeof options.onStateChange === 'function') options.onStateChange(state, event);
    return state;
  }
  var controller = {
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
  bindExplorerEvents(root, metadata, dispatch, options.onClear);
  renderExplorerControls(root, metadata, state);
  return controller;
}
