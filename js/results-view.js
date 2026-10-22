import { esc } from './utils.js';
import { getSortedYears } from './metadata.js';
import { buildSchoolDetailHtml, buildScoreSegmentsHtml, buildYearSummaryHtml } from './year-stack.js';

function statusHtml(model) {
  if (model.status === 'loading') return '<div class="result-state"><span class="loading">正在加载历年院校与一分一段数据…</span></div>';
  if (model.status === 'error') return '<div class="result-state result-error">加载失败：' + esc(model.error || '未知错误') + '</div>';
  if (model.status === 'unpublished') return '<div class="result-state">该年份数据尚未发布</div>';
  if (!model.hasQuery) return '<div class="result-state">输入专科专业，回车或点击查询开始检索</div>';
  return '<div class="result-state">当前筛选条件下没有符合的本科专业</div>';
}

function majorSummaryHtml(aggregate, metadata, index) {
  var major = aggregate.major || {};
  var course = major.professionalCourse || {};
  var years = getSortedYears(metadata);
  return '<article class="aggregate-card" data-major-index="' + index + '">' +
    '<header><div><h3>' + esc(major.majorName || '') + '</h3>' +
    '<p>专业代码 ' + esc(major.majorCode || '—') + ' · 公共课 ' + esc(major.publicCourse || '—') +
    ' · 专业基础课 ' + esc(course.name || '—') + (course.code ? ' (' + esc(course.code) + ')' : '') + '</p></div></header>' +
    '<div class="aggregate-years">' + years.map(function (year) {
      var yearAggregate = aggregate.years && aggregate.years[year];
      return '<section class="aggregate-year"><h4>' + year + ' 年</h4>' + buildYearSummaryHtml(yearAggregate) +
        '<button type="button" data-expand-year="' + year + '" data-major-index="' + index + '">展开院校与分数段</button>' +
        '<div class="aggregate-year-detail" data-year-detail="' + year + '"></div></section>';
    }).join('') + '</div></article>';
}

export function buildResultWorkspaceHtml(model, metadata) {
  var aggregates = model.aggregates || [];
  if (!aggregates.length) return statusHtml(model);
  return '<div class="aggregate-list">' + aggregates.map(function (aggregate, index) {
    return majorSummaryHtml(aggregate, metadata, index);
  }).join('') + '</div>';
}

export function buildExpandedYearHtml(aggregate, year) {
  var yearAggregate = aggregate && aggregate.years && aggregate.years[year];
  if (!yearAggregate) return '<div class="result-state">该年份数据尚未发布</div>';
  return '<div class="school-detail-list">' + (yearAggregate.schools || []).map(buildSchoolDetailHtml).join('') + '</div>' +
    buildScoreSegmentsHtml(yearAggregate.scoreSegments);
}

export function renderResultWorkspace(root, model, metadata, dispatch) {
  root.innerHTML = buildResultWorkspaceHtml(model, metadata);
  root.onclick = function (event) {
    var button = event.target.closest('[data-expand-year]');
    if (!button || !root.contains(button)) return;
    var majorIndex = Number(button.getAttribute('data-major-index'));
    var year = Number(button.getAttribute('data-expand-year'));
    var holder = button.parentElement.querySelector('[data-year-detail="' + year + '"]');
    var opening = !holder.hasChildNodes();
    holder.innerHTML = opening ? buildExpandedYearHtml(model.aggregates[majorIndex], year) : '';
    button.textContent = opening ? '收起院校与分数段' : '展开院校与分数段';
    if (dispatch) dispatch({ type: opening ? 'EXPAND_YEAR' : 'COLLAPSE_YEAR', majorIndex: majorIndex, year: year });
  };
}
