import { esc } from './utils.js';
import { getSortedYears, normalizeSelectedYears } from './metadata.js';
import { buildSchoolComparisonHtml, buildScoreSegmentsHtml, buildYearSummaryHtml } from './year-stack.js';
import { hiddenResultFields } from './result-visibility.js';

export function resultMessage(model) {
  if (model.status === 'loading') return '正在整理历年专业摘要…';
  if (model.status === 'error') return '加载失败：' + (model.error || '未知错误');
  if (model.status === 'unpublished') return '该年份数据尚未发布';
  if (!model.hasQuery) return '输入专科专业，回车或点击查询开始检索';
  return '当前筛选条件下没有符合的本科专业';
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

function detailKey(aggregate) {
  var major = aggregate && aggregate.major || {};
  return String(major.majorId || major.majorCode || major.majorName || '');
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
  var expanded = Boolean(expandedDetails[detailKey(aggregate)]);
  return '<article class="aggregate-card" data-major-index="' + index + '">' +
    majorHeaderHtml(aggregate, index, expanded) +
    yearOverviewHtml(aggregate, years, false, hiddenFields) +
    '<div class="aggregate-major-detail" data-major-detail="' + index + '">' +
    (expanded ? buildExpandedMajorHtml(aggregate, years, hiddenFields) : '') + '</div></article>';
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
    var expanded = Boolean(expandedDetails[detailKey(aggregate)]);
    return '<tr class="aggregate-table-row"><td>' + esc(major.majorName || '') + '</td><td>' + esc(major.publicCourse || '—') +
      '</td><td>' + esc(course.name || '—') + '</td><td>' + yearOverviewHtml(aggregate, years, true, hiddenFields) + '</td><td>' +
      detailButtonHtml(index, '查看院校详情', expanded) + '</td></tr>' +
      '<tr class="aggregate-table-detail"' + (expanded ? '' : ' hidden') + '><td colspan="5"><div class="aggregate-major-detail" data-major-detail="' + index + '">' +
      (expanded ? buildExpandedMajorHtml(aggregate, years, hiddenFields) : '') + '</div></td></tr>';
  }).join('');
}

function tableHtml(model, metadata) {
  var focusYear = model.selectedYears.length ? model.selectedYears[model.selectedYears.length - 1] : null;
  var yearColumnWidth = model.selectedYears.length * 176 + Math.max(0, model.selectedYears.length - 1) * 8 + 24;
  var tableMinWidth = Math.max(1040, 620 + yearColumnWidth);
  var headers = '<thead><tr>' + sortButton('本科专业', 'majorName', model, metadata) +
    '<th>公共课</th><th>专业基础课</th>' +
    (focusYear == null ? '<th>历年概览</th><th>院校对比</th>' :
      sortButton('历年概览', 'score' + focusYear, model, metadata) +
      sortButton('院校对比', 'schoolCount' + focusYear, model, metadata)) +
    '</tr></thead>';
  return '<div class="aggregate-table-wrap"><table class="aggregate-table" style="--table-min-width:' + tableMinWidth + 'px;--year-column-width:' + yearColumnWidth + 'px">' + headers +
    '<tbody>' + tableRowsHtml(model.aggregates, model.selectedYears || getSortedYears(metadata), model.expandedDetails, model.hiddenFields) + '</tbody></table></div>';
}

export function buildYearDialogHtml(metadata, selectedYears) {
  var years = getSortedYears(metadata);
  var selected = selectedYears || years;
  var focusYear = selected.length ? selected[selected.length - 1] : null;
  return '<dialog class="year-selection-dialog" aria-labelledby="year-selection-title">' +
    '<form method="dialog"><h2 id="year-selection-title">显示年份</h2><p class="year-selection-summary">已选 ' + selected.length + '/' + years.length + ' 年 · 当前基准：' + esc(focusYear == null ? '—' : focusYear + ' 年') + '</p><p>勾选后会同步影响专业摘要、院校明细和导出字段。</p>' +
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
  if (!viewModel.aggregates.length) return '';
  var content = viewModel.resultLayout === 'table'
    ? tableHtml(viewModel, metadata)
    : '<div class="aggregate-list">' + viewModel.aggregates.map(function (aggregate, index) {
      return majorSummaryHtml(aggregate, viewModel.selectedYears, index, viewModel.expandedDetails, viewModel.hiddenFields);
    }).join('') + '</div>';
  return content;
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
