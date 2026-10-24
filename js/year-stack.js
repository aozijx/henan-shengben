import { esc } from './utils.js';
import { resultFieldVisible } from './result-visibility.js';

function text(value) {
  return value == null || value === '' ? '—' : esc(String(value));
}

function summaryPart(label, summary, hiddenFields) {
  var value = summary || {};
  return '<span class="year-kind year-kind-' + (label === '公办' ? 'public' : 'private') + '"><strong>' + label +
    '</strong><span>' + (value.schoolCount || 0) + ' 所 · 普通 ' + (value.ordinaryPlanCount || 0) + ' 人' +
    (resultFieldVisible(hiddenFields, 'povertyPlan') ? ' · 专项 ' + (value.povertyPlanCount || 0) + ' 人' : '') + '</span></span>';
}

export function buildYearSummaryHtml(yearAggregate, hiddenFields) {
  if (!yearAggregate) return '<span class="year-unpublished">该年份数据尚未发布</span>';
  var score = yearAggregate.score == null ? '—' : yearAggregate.score;
  return '<div class="year-summary">' +
    '<span class="year-score"><strong>省控线</strong><span>' + esc(String(score)) + '</span></span>' +
    summaryPart('公办', yearAggregate.publicSummary, hiddenFields) +
    summaryPart('民办', yearAggregate.privateSummary, hiddenFields) +
    '</div>';
}

function planRecordHtml(entry) {
  var detail = entry || {};
  var charter = detail.charterUrl
    ? '<a href="' + esc(detail.charterUrl) + '" target="_blank" rel="noopener noreferrer">招生章程</a>'
    : '—';
  return '<section class="school-plan-record">' +
    '<div class="school-plan-record-title">' + text(detail.admissionCategory) + '</div>' +
    '<dl>' +
    '<dt>院校代码</dt><dd>' + text(detail.schoolCode) + '</dd>' +
    '<dt>专业代号</dt><dd>' + text(detail.majorCode) + '</dd>' +
    '<dt>专业名称</dt><dd>' + text(detail.majorName) + '</dd>' +
    '<dt>学制</dt><dd>' + (detail.duration == null ? '—' : esc(String(detail.duration)) + ' 年') + '</dd>' +
    '<dt>学费</dt><dd>' + (detail.tuition == null ? '—' : '¥' + esc(String(detail.tuition)) + ' / 年') + '</dd>' +
    '<dt>住宿费</dt><dd>' + (detail.accommodation == null ? '—' : '¥' + esc(String(detail.accommodation)) + ' / 年') + '</dd>' +
    '<dt>地址</dt><dd>' + text(detail.address) + '</dd>' +
    '<dt>咨询电话</dt><dd>' + text(detail.phone) + '</dd>' +
    '<dt>办学地点/备注</dt><dd>' + text(detail.notes) + '</dd>' +
    '<dt>招生章程</dt><dd>' + charter + '</dd>' +
    '</dl></section>';
}

export function buildSchoolDetailHtml(school, year, hiddenFields) {
  var entries = school.planEntries || [];
  var yearLabel = year == null ? '' : '<span class="school-year-badge">' + esc(String(year)) + ' 年</span>';
  var records = entries.length
    ? entries.map(planRecordHtml).join('')
    : '<p class="school-detail-empty">该院校仅有招生高校总表回退信息，暂无计划明细。</p>';
  return '<article class="school-detail">' +
    '<header><h5>' + esc(school.schoolName || '') + '</h5>' + yearLabel +
    '<span class="school-type">' + esc(school.schoolType || '—') + '</span></header>' +
    '<p class="school-plan-summary">普通计划 ' + (school.ordinaryPlanCount || 0) + ' 人' +
    (resultFieldVisible(hiddenFields, 'povertyPlan') ? ' · 建档立卡专项 ' + (school.povertyPlanCount || 0) + ' 人' : '') + '</p>' +
    records +
    '</article>';
}

function schoolKey(school) {
  return school.schoolId || school.schoolName || '';
}

export function buildSchoolComparisonHtml(aggregate, years, hiddenFields) {
  var groups = new Map();
  (years || []).forEach(function (year) {
    var yearAggregate = aggregate && aggregate.years && aggregate.years[year];
    (yearAggregate && yearAggregate.schools || []).forEach(function (school) {
      var key = schoolKey(school);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ year: year, school: school });
    });
  });
  if (!groups.size) return '<div class="result-state">所选年份暂无院校招生计划。</div>';
  return '<div class="school-comparison-list">' + Array.from(groups.values()).map(function (records) {
    return '<section class="school-comparison-card">' + records.map(function (record) {
      return buildSchoolDetailHtml(record.school, record.year, hiddenFields);
    }).join('') + '</section>';
  }).join('') + '</div>';
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
