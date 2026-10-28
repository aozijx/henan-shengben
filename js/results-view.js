import { esc } from './utils.js';
import { getSelectableYears, normalizeSelectedYears } from './metadata.js';
import { buildSchoolComparisonHtml, buildScoreSegmentsHtml, buildYearAdmissionsHtml, buildYearScoreHtml, buildYearSummaryHtml } from './year-stack.js';
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
    selectedMajorKey: source.selectedMajorKey || '',
    schoolLayout: source.schoolLayout === 'list' ? 'list' : 'cards',
    showProfessionalCourse: !source.filters || !source.filters.subject || source.filters.subject === '全部',
    hiddenFields: hiddenResultFields(metadata, source.filters)
  };
}

function detailKey(aggregate) {
  var major = aggregate && aggregate.major || {};
  return String(major.majorId || major.majorCode || major.majorName || '');
}

function detailButtonHtml(index, selected) {
  return '<button type="button" data-select-major="' + index + '" aria-pressed="' + String(selected) + '">' +
    esc(selected ? '当前院校' : '查看院校') + '</button>';
}

function courseMeta(course, visible) {
  if (!visible) return '';
  return ' · 专业基础课 ' + esc(course.name || '—') + (course.code ? ' (' + esc(course.code) + ')' : '');
}

function majorHeaderHtml(aggregate, index, selected, showProfessionalCourse) {
  var major = aggregate.major || {};
  var course = major.professionalCourse || {};
  return '<header><div class="aggregate-card-heading"><div><h3>' + esc(major.majorName || '') + '</h3>' +
    '<p>专业代码 ' + esc(major.majorCode || '—') + ' · 公共课 ' + esc(major.publicCourse || '—') +
    courseMeta(course, showProfessionalCourse) + '</p></div>' +
    '<div class="aggregate-detail-action">' + detailButtonHtml(index, selected) + '</div></div></header>';
}

function yearOverviewHtml(aggregate, years, hiddenFields) {
  return '<div class="year-overview">' + years.map(function (year) {
    var value = aggregate.years && aggregate.years[year];
    return '<section class="year-overview-item"><h4>' + year + ' 年</h4>' + buildYearSummaryHtml(value, hiddenFields) + '</section>';
  }).join('') + '</div>';
}

function majorSummaryHtml(aggregate, years, index, selectedMajorKey, hiddenFields, showProfessionalCourse) {
  var selected = selectedMajorKey === detailKey(aggregate);
  return '<article class="aggregate-card" data-major-index="' + index + '">' +
    majorHeaderHtml(aggregate, index, selected, showProfessionalCourse) + yearOverviewHtml(aggregate, years, hiddenFields) + '</article>';
}

function sortButton(label, key, model, metadata, trailingHtml, ariaLabel, className) {
  var field = (metadata.fields || []).find(function (item) { return item.key === key; });
  var classes = (field && field.sortEnable ? 'sortable ' : '') + (className || '');
  if (!field || !field.sortEnable) return '<th' + (classes ? ' class="' + classes.trim() + '"' : '') + '>' + esc(label) + (trailingHtml || '') + '</th>';
  var direction = model.sort && model.sort.key === key ? model.sort.direction : null;
  var indicator = direction === 'desc' ? '▼' : direction === 'asc' ? '▲' : '';
  var ariaSort = direction === 'desc' ? ' aria-sort="descending"'
    : direction === 'asc' ? ' aria-sort="ascending"' : '';
  return '<th class="' + classes.trim() + '"' + ariaSort + '>' +
    '<button type="button" data-result-sort="' + esc(key) + '" aria-label="' + esc(ariaLabel || '按' + label + '排序') + '">' +
    esc(label) + '<span class="sort-ind" aria-hidden="true">' + indicator + '</span></button>' +
    (trailingHtml || '') + '</th>';
}

function tableMetricValue(aggregate, year, renderMetric, hiddenFields) {
  var value = aggregate.years && aggregate.years[year];
  if (value) return renderMetric(value, hiddenFields);
  return '<span class="year-unpublished" title="该年份数据尚未发布">—<span class="visually-hidden">该年份数据尚未发布</span></span>';
}

function tableRowsHtml(aggregates, years, selectedMajorKey, hiddenFields, showProfessionalCourse) {
  return aggregates.map(function (aggregate, index) {
    var major = aggregate.major || {};
    var course = major.professionalCourse || {};
    var selected = selectedMajorKey === detailKey(aggregate);
    var majorMeta = '专业代码 ' + (major.majorCode || '—') + ' · 公共课 ' + (major.publicCourse || '—') +
      (showProfessionalCourse ? ' · 专业基础课 ' + (course.name || '—') + (course.code ? ' (' + course.code + ')' : '') : '');
    var scoreCells = years.map(function (year) {
      return '<td class="aggregate-score-cell score-year-cell">' + tableMetricValue(aggregate, year, function (value) {
        return buildYearScoreHtml(value) +
          '<span class="estimated-score" title="按该专业普通计划人数和一分一段累计人数估算，仅供参考">预估最低分 <b>' +
          (value.estimatedMinScore == null ? '—' : esc(String(value.estimatedMinScore))) + '</b></span>';
      }, hiddenFields) + '</td>';
    }).join('');
    var admissionCells = years.map(function (year) {
      return '<td class="aggregate-admissions-cell admission-year-cell">' + tableMetricValue(aggregate, year, function (value, fields) {
        return buildYearAdmissionsHtml(value, fields, true);
      }, hiddenFields) + '</td>';
    }).join('');
    return '<tr class="aggregate-table-row"><td class="aggregate-major-cell"><strong>' + esc(major.majorName || '') +
      '</strong><span class="aggregate-major-meta">' + esc(majorMeta) + '</span></td>' +
      scoreCells + admissionCells +
      '<td>' + detailButtonHtml(index, selected) + '</td></tr>';
  }).join('');
}

function tableHtml(model, metadata) {
  var yearCount = model.selectedYears.length;
  var scoreColumnWidth = 132;
  var admissionsColumnWidth = 200;
  var detailColumnWidth = 112;
  var tableMinWidth = Math.max(720, 210 + detailColumnWidth + yearCount * (scoreColumnWidth + admissionsColumnWidth));
  var scoreHeaders = model.selectedYears.map(function (year) {
    return sortButton(year + ' 年', 'score' + year, model, metadata, '', '按' + year + ' 年省控线排序', 'score-year-column');
  }).join('');
  var admissionsHeaders = model.selectedYears.map(function (year) {
    return '<th class="admission-year-column"><span class="admission-year-label">' + year + ' 年 ' +
      '<span class="year-kind-public">公办</span>/<span class="year-kind-private">民办</span></span></th>';
  }).join('');
  var headers = '<thead><tr>' + sortButton('本科专业', 'majorName', model, metadata, '', null, 'aggregate-major-column') +
    scoreHeaders + admissionsHeaders +
    '<th class="aggregate-detail-column">院校详情</th>' +
    '</tr></thead>';
  return '<div class="aggregate-table-wrap"><div class="aggregate-table-scroll-hint">横向滑动查看其他年份和院校列</div><table class="aggregate-table" style="--table-min-width:' + tableMinWidth + 'px;--score-column-width:' + scoreColumnWidth + 'px;--admissions-column-width:' + admissionsColumnWidth + 'px;--detail-column-width:' + detailColumnWidth + 'px;--year-count:' + yearCount + '">' + headers +
    '<tbody>' + tableRowsHtml(model.aggregates, model.selectedYears, model.selectedMajorKey, model.hiddenFields, model.showProfessionalCourse) + '</tbody></table></div>';
}

export function buildYearDialogHtml(metadata, selectedYears) {
  var years = getSelectableYears(metadata);
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
      return majorSummaryHtml(aggregate, viewModel.selectedYears, index, viewModel.selectedMajorKey, viewModel.hiddenFields, viewModel.showProfessionalCourse);
    }).join('') + '</div>';
  return content;
}

export function buildExpandedMajorHtml(aggregate, years, hiddenFields, schoolYears) {
  var segments = (years || []).map(function (year) {
    var yearAggregate = aggregate && aggregate.years && aggregate.years[year];
    return '<details class="score-segment-year"><summary>' + year + ' 年一分一段</summary>' +
      buildScoreSegmentsHtml(yearAggregate && yearAggregate.scoreSegments) + '</details>';
  }).join('');
  return '<section class="school-comparison"><h4>院校计划对比</h4>' + buildSchoolComparisonHtml(aggregate, schoolYears || years, hiddenFields) +
    '</section><section class="score-segment-comparison"><h4>一分一段</h4>' + segments + '</section>';
}
