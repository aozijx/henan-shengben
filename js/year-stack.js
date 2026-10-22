import { esc } from './utils.js';

function summaryPart(label, summary) {
  var value = summary || {};
  return '<span class="year-kind year-kind-' + (label === '公办' ? 'public' : 'private') + '">' + label + ' ' +
    (value.schoolCount || 0) + ' 所 · 普通 ' + (value.ordinaryPlanCount || 0) + ' 人 · 专项 ' +
    (value.povertyPlanCount || 0) + ' 人</span>';
}

export function buildYearSummaryHtml(yearAggregate) {
  if (!yearAggregate) return '<span class="year-unpublished">该年份数据尚未发布</span>';
  var context = yearAggregate.scoreContext || {};
  var score = yearAggregate.score == null ? '—' : yearAggregate.score;
  var rank = context.controlCumulativeCount == null ? '—' : context.controlCumulativeCount;
  return '<div class="year-summary">' +
    '<span class="year-score">省控线 ' + esc(String(score)) + '</span>' +
    '<span class="year-rank">参考位次 ' + esc(String(rank)) + '</span>' +
    summaryPart('公办', yearAggregate.publicSummary) +
    summaryPart('民办', yearAggregate.privateSummary) +
    '</div>';
}

export function buildSchoolDetailHtml(school) {
  var entries = school.planEntries || [];
  var detail = entries[0] || {};
  return '<article class="school-detail">' +
    '<h5>' + esc(school.schoolName || '') + ' <span>' + esc(school.schoolType || '') + '</span></h5>' +
    '<p>普通计划 ' + (school.ordinaryPlanCount || 0) + ' 人 · 建档立卡专项 ' + (school.povertyPlanCount || 0) + ' 人</p>' +
    '<dl><dt>学费</dt><dd>' + esc(detail.tuition == null ? '—' : String(detail.tuition)) + '</dd>' +
    '<dt>地址</dt><dd>' + esc(detail.address || '—') + '</dd>' +
    '<dt>咨询电话</dt><dd>' + esc(detail.phone || '—') + '</dd></dl>' +
    '</article>';
}

export function buildScoreSegmentsHtml(series) {
  if (!series || !Array.isArray(series.segments) || !series.segments.length) {
    return '<div class="score-segments-empty">该年份暂无一分一段数据</div>';
  }
  return '<section class="score-segments"><h5>完整分数段</h5><div class="score-segments-scroll"><table>' +
    '<thead><tr><th>分数</th><th>累计人数 / 参考位次</th></tr></thead><tbody>' +
    series.segments.map(function (item) {
      return '<tr><td>' + esc(String(item.score)) + '</td><td>' + esc(String(item.cumulativeCount)) + '</td></tr>';
    }).join('') + '</tbody></table></div></section>';
}
