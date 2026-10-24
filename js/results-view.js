import { esc } from './utils.js';
import { getSortedYears, normalizeSelectedYears } from './metadata.js';
import { buildSchoolComparisonHtml, buildScoreSegmentsHtml, buildYearSummaryHtml } from './year-stack.js';
import { hiddenResultFields } from './result-visibility.js';
import { nextSortDirection } from './preview.js';

var resultViewStates = new WeakMap();

function statusHtml(model) {
  if (model.status === 'loading') return '<div class="result-state"><span class="loading">正在整理历年专业摘要…</span></div>';
  if (model.status === 'error') return '<div class="result-state result-error">加载失败：' + esc(model.error || '未知错误') + '</div>';
  if (model.status === 'unpublished') return '<div class="result-state">该年份数据尚未发布</div>';
  if (!model.hasQuery) return '<div class="result-state">输入专科专业，回车或点击查询开始检索</div>';
  return '<div class="result-state">当前筛选条件下没有符合的本科专业</div>';
}

export function buildResultViewModel(model, metadata) {
  var source = model || {};
  return {
    ...source,
    aggregates: Array.isArray(source.aggregates) ? source.aggregates : [],
    selectedYears: normalizeSelectedYears(source.selectedYears, metadata),
    resultLayout: source.resultLayout === 'table' ? 'table' : 'cards',
    expandedDetails: { ...(source.expandedDetails || {}) },
    hiddenFields: hiddenResultFields(metadata, source.filters)
  };
}

function detailKey(index) {
  return String(index);
}

function detailButtonHtml(index, label, expanded) {
  return '<button type="button" data-expand-major="' + index + '" data-expand-label="' + esc(label) +
    '" aria-expanded="' + String(expanded) + '">' + esc(expanded ? '收起院校详情' : label) + '</button>';
}

function majorHeaderHtml(aggregate, index, expanded) {
  var major = aggregate.major || {};
  var course = major.professionalCourse || {};
  return '<header><div class="aggregate-card-heading"><div><h3>' + esc(major.majorName || '') + '</h3>' +
    '<p>专业代码 ' + esc(major.majorCode || '—') + ' · 公共课 ' + esc(major.publicCourse || '—') +
    ' · 专业基础课 ' + esc(course.name || '—') + (course.code ? ' (' + esc(course.code) + ')' : '') + '</p></div>' +
    '<div class="aggregate-detail-action">' + detailButtonHtml(index, '查看院校详情', expanded) + '</div></div></header>';
}

function yearOverviewHtml(aggregate, years, compact, hiddenFields) {
  return '<div class="year-overview' + (compact ? ' year-overview-compact' : '') + '">' + years.map(function (year) {
    var value = aggregate.years && aggregate.years[year];
    return '<section class="year-overview-item"><h4>' + year + ' 年</h4>' + buildYearSummaryHtml(value, hiddenFields) + '</section>';
  }).join('') + '</div>';
}

function majorSummaryHtml(aggregate, years, index, expandedDetails, hiddenFields) {
  var expanded = Boolean(expandedDetails[detailKey(index)]);
  return '<article class="aggregate-card" data-major-index="' + index + '">' +
    majorHeaderHtml(aggregate, index, expanded) +
    yearOverviewHtml(aggregate, years, false, hiddenFields) +
    '<div class="aggregate-major-detail" data-major-detail="' + index + '">' +
    (expanded ? buildExpandedMajorHtml(aggregate, years, hiddenFields) : '') + '</div></article>';
}

function layoutIconHtml(layout) {
  var shape = layout === 'cards'
    ? '<rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1"></rect><rect x="9" y="1.5" width="5.5" height="5.5" rx="1"></rect><rect x="1.5" y="9" width="5.5" height="5.5" rx="1"></rect><rect x="9" y="9" width="5.5" height="5.5" rx="1"></rect>'
    : '<path d="M2 3.25h12M2 8h12M2 12.75h12"></path><circle cx="3" cy="3.25" r=".5"></circle><circle cx="3" cy="8" r=".5"></circle><circle cx="3" cy="12.75" r=".5"></circle>';
  return '<svg class="layout-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' + shape + '</svg>';
}

function toolbarHtml(model, metadata) {
  var cards = model.resultLayout !== 'table';
  return '<div class="result-toolbar" aria-label="结果显示设置">' +
    '<div class="result-layout-switch" role="group" aria-label="结果布局">' +
    '<button type="button" data-result-layout="cards" aria-label="切换为聚合卡片" title="聚合卡片"' + (cards ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' + layoutIconHtml('cards') + '</button>' +
    '<button type="button" data-result-layout="table" aria-label="切换为表格" title="表格"' + (!cards ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' + layoutIconHtml('table') + '</button>' +
    '</div>' +
    '</div>';
}

function sortButton(label, key, model, metadata) {
  var field = (metadata.fields || []).find(function (item) { return item.key === key; });
  if (!field || !field.sortEnable) return '<th>' + esc(label) + '</th>';
  var direction = model.sort && model.sort.key === key ? model.sort.direction : null;
  var indicator = direction === 'desc' ? '▼' : direction === 'asc' ? '▲' : '';
  var ariaSort = direction === 'desc' ? ' aria-sort="descending"'
    : direction === 'asc' ? ' aria-sort="ascending"' : '';
  return '<th class="sortable"' + ariaSort + '>' +
    '<button type="button" data-result-sort="' + esc(key) + '" aria-label="按' + esc(label) + '排序">' +
    esc(label) + '<span class="sort-ind" aria-hidden="true">' + indicator + '</span></button></th>';
}

function tableRowsHtml(aggregates, years, expandedDetails, hiddenFields) {
  return aggregates.map(function (aggregate, index) {
    var major = aggregate.major || {};
    var course = major.professionalCourse || {};
    var expanded = Boolean(expandedDetails[detailKey(index)]);
    return '<tr class="aggregate-table-row"><td>' + esc(major.majorName || '') + '</td><td>' + esc(major.publicCourse || '—') +
      '</td><td>' + esc(course.name || '—') + '</td><td>' + yearOverviewHtml(aggregate, years, true, hiddenFields) + '</td><td>' +
      detailButtonHtml(index, '查看院校详情', expanded) + '</td></tr>' +
      '<tr class="aggregate-table-detail"' + (expanded ? '' : ' hidden') + '><td colspan="5"><div class="aggregate-major-detail" data-major-detail="' + index + '">' +
      (expanded ? buildExpandedMajorHtml(aggregate, years, hiddenFields) : '') + '</div></td></tr>';
  }).join('');
}

function tableHtml(model, metadata) {
  var focusYear = model.selectedYears.length ? model.selectedYears[model.selectedYears.length - 1] : null;
  var headers = '<thead><tr>' + sortButton('本科专业', 'majorName', model, metadata) +
    '<th>公共课</th><th>专业基础课</th>' +
    (focusYear == null ? '<th>历年概览</th><th>院校对比</th>' :
      sortButton('历年概览', 'score' + focusYear, model, metadata) +
      sortButton('院校对比', 'schoolCount' + focusYear, model, metadata)) +
    '</tr></thead>';
  return '<div class="aggregate-table-wrap"><table class="aggregate-table">' + headers +
    '<tbody>' + tableRowsHtml(model.aggregates, model.selectedYears || getSortedYears(metadata), model.expandedDetails, model.hiddenFields) + '</tbody></table></div>';
}

export function buildYearDialogHtml(metadata, selectedYears) {
  var years = getSortedYears(metadata);
  var selected = selectedYears || years;
  var focusYear = selected.length ? selected[selected.length - 1] : null;
  return '<dialog class="year-selection-dialog" aria-labelledby="year-selection-title">' +
    '<form method="dialog"><h2 id="year-selection-title">显示年份</h2><p class="year-selection-summary">已选 ' + selected.length + '/' + years.length + ' 年 · 当前基准：' + esc(focusYear == null ? '—' : focusYear + ' 年') + '</p><p>勾选后会同步影响筛选、预览和导出。</p>' +
    '<fieldset><legend>展示年份</legend>' + years.map(function (year) {
      return '<label><input type="checkbox" name="selected-year" value="' + year + '"' +
        (selected.indexOf(year) >= 0 ? ' checked' : '') + '> ' + year + ' 年</label>';
    }).join('') + '</fieldset><p class="year-selection-error" aria-live="polite"></p>' +
    '<div class="year-selection-actions"><button type="button" data-year-select="all">全选</button>' +
    '<button type="button" data-year-select="latest">仅最新年份</button>' +
    '<button type="submit" value="cancel">取消</button><button type="button" data-year-apply>应用</button></div></form></dialog>';
}

export function buildResultWorkspaceHtml(model, metadata) {
  var viewModel = buildResultViewModel(model, metadata);
  if (!viewModel.aggregates.length) return statusHtml(viewModel);
  var content = viewModel.resultLayout === 'table'
    ? tableHtml(viewModel, metadata)
    : '<div class="aggregate-list">' + viewModel.aggregates.map(function (aggregate, index) {
      return majorSummaryHtml(aggregate, viewModel.selectedYears, index, viewModel.expandedDetails, viewModel.hiddenFields);
    }).join('') + '</div>';
  return toolbarHtml(viewModel, metadata) + content;
}

export function buildExpandedMajorHtml(aggregate, years, hiddenFields) {
  var segments = (years || []).map(function (year) {
    var yearAggregate = aggregate && aggregate.years && aggregate.years[year];
    return '<details class="score-segment-year"><summary>' + year + ' 年一分一段</summary>' +
      buildScoreSegmentsHtml(yearAggregate && yearAggregate.scoreSegments) + '</details>';
  }).join('');
  return '<section class="school-comparison"><h4>院校计划对比</h4>' + buildSchoolComparisonHtml(aggregate, years, hiddenFields) +
    '</section><section class="score-segment-comparison"><h4>一分一段</h4>' + segments + '</section>';
}

export function toggleMajorDetail(root, aggregates, button, expandedDetails, years, hiddenFields) {
  var majorIndex = Number(button.getAttribute('data-expand-major'));
  var key = detailKey(majorIndex);
  var holder = root.querySelector('[data-major-detail="' + majorIndex + '"]');
  if (!holder || !expandedDetails) return false;
  var opening = !expandedDetails[key];
  if (opening) expandedDetails[key] = true;
  else delete expandedDetails[key];
  holder.innerHTML = opening ? buildExpandedMajorHtml(aggregates[majorIndex], years, hiddenFields) : '';
  var detailRow = typeof holder.closest === 'function' ? holder.closest('.aggregate-table-detail') : null;
  if (detailRow) detailRow.hidden = !opening;
  button.textContent = opening ? '收起院校详情' : (button.dataset.expandLabel || '查看院校详情');
  button.setAttribute('aria-expanded', String(opening));
  return opening;
}

function resultSignature(model) {
  return model.selectedYears.join(',') + '|' + model.aggregates.map(function (aggregate) {
    var major = aggregate.major || {};
    return major.majorId || major.majorCode || major.majorName || '';
  }).join('|');
}

function getResultViewState(root, model) {
  var state = resultViewStates.get(root);
  var signature = resultSignature(model);
  if (!state || (model.status !== 'loading' && state.signature !== signature)) {
    state = { signature: signature, expandedDetails: {} };
    resultViewStates.set(root, state);
  }
  if (model.status !== 'loading') state.signature = signature;
  return state;
}

function within(root, target, selector) {
  if (!target || typeof target.closest !== 'function') return null;
  var match = target.closest(selector);
  return match && root.contains(match) ? match : null;
}

function handleResultClick(root, model, metadata, dispatch, event, expandedDetails, onExpand) {
  var sort = within(root, event.target, '[data-result-sort]');
  if (sort && dispatch) {
    var key = sort.dataset.resultSort;
    dispatch({ type: 'SET_SORT', sort: { key: key, direction: nextSortDirection(model.sort, key) } });
    return;
  }
  var layout = within(root, event.target, '[data-result-layout]');
  if (layout) {
    if (dispatch) dispatch({ type: 'SET_RESULT_LAYOUT', resultLayout: layout.dataset.resultLayout });
    return;
  }
  var detailButton = within(root, event.target, '[data-expand-major]');
  if (detailButton) {
    var opening = toggleMajorDetail(root, model.aggregates, detailButton, expandedDetails, model.selectedYears, model.hiddenFields);
    if (opening && onExpand) onExpand(model.aggregates[Number(detailButton.dataset.expandMajor)], model.selectedYears,
      root.querySelector('[data-major-detail="' + detailButton.dataset.expandMajor + '"]'), model.hiddenFields);
  }
}

export function renderResultWorkspace(root, model, metadata, dispatch, onExpand) {
  var viewModel = buildResultViewModel(model, metadata);
  var viewState = getResultViewState(root, viewModel);
  viewModel = { ...viewModel, expandedDetails: viewState.expandedDetails };
  root.innerHTML = buildResultWorkspaceHtml(viewModel, metadata);
  root.onclick = function (event) { handleResultClick(root, viewModel, metadata, dispatch, event, viewState.expandedDetails, onExpand); };
}
