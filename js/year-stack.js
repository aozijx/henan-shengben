import { esc } from './utils.js';
import { resultFieldVisible } from './result-visibility.js';

function text(value) {
  return value == null || value === '' ? '—' : esc(String(value));
}

function summaryPart(label, summary, hiddenFields, compact) {
  var value = summary || {};
  var hasNoSchools = Number(value.schoolCount || 0) === 0;
  return '<span class="year-kind year-kind-' + (label === '公办' ? 'public' : 'private') + '">' +
    (compact ? '' : '<strong>' + label + '</strong>') + '<span>' + (hasNoSchools ? '—' :
      (value.schoolCount || 0) + ' 所 · 普通 ' + (value.ordinaryPlanCount || 0) + ' 人' +
      (resultFieldVisible(hiddenFields, 'povertyPlan') ? ' · 专项 ' + (value.povertyPlanCount || 0) + ' 人' : '')) + '</span></span>';
}

export function buildYearSummaryHtml(yearAggregate, hiddenFields) {
  if (!yearAggregate) return '<span class="year-unpublished">该年份数据尚未发布</span>';
  return '<div class="year-summary">' +
    buildYearScoreHtml(yearAggregate) +
    buildYearAdmissionsHtml(yearAggregate, hiddenFields) +
    '</div>';
}

export function buildYearScoreHtml(yearAggregate, showLabel) {
  if (!yearAggregate) return '<span class="year-unpublished">该年份数据尚未发布</span>';
  return '<span class="year-score">' + (showLabel === false ? '' : '<strong>省控线</strong>') + '<span>' +
    (yearAggregate.scorePublished === false ? '未公布' : text(yearAggregate.score)) + '</span></span>';
}

export function buildYearAdmissionsHtml(yearAggregate, hiddenFields, compact) {
  if (!yearAggregate) return '<span class="year-unpublished">该年份数据尚未发布</span>';
  if (yearAggregate.planPublished === false) {
    var count = (yearAggregate.schools || []).length;
    return '<span class="year-unpublished">' + (count ? count + ' 所院校 · ' : '') + '招生计划人数未公布</span>';
  }
  var unclassified = (yearAggregate.schools || []).filter(function (school) {
    return school.schoolType !== '公办' && school.schoolType !== '民办';
  }).length;
  var unlisted = (yearAggregate.schools || []).filter(function (school) { return school.fallbackOnly; }).length;
  return summaryPart('公办', yearAggregate.publicSummary, hiddenFields, compact) +
    summaryPart('民办', yearAggregate.privateSummary, hiddenFields, compact) +
    (unclassified ? '<span class="year-kind">办学性质未标注 ' + unclassified + ' 所</span>' : '') +
    (unlisted ? '<span class="year-kind">另有 ' + unlisted + ' 所计划未单列</span>' : '');
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

function masterRecordHtml(row) {
  var fields = Object.entries(row).filter(function ([key]) {
    return !key.startsWith('_') &&
      !(key === '院校名称' && Object.hasOwn(row, '学校名称')) &&
      !(key === '院校代号' && Object.hasOwn(row, '院校代码'));
  });
  return '<section class="school-plan-record school-master-record"><div class="school-plan-record-title">招生高校及专业总表</div>' +
    '<dl>' + fields.map(function ([key, value]) {
      return '<dt>' + esc(key) + '</dt><dd>' + (value == null || value === '' ? '—' : text(value)) + '</dd>';
    }).join('') + '</dl></section>';
}

function schoolTableColumns(records) {
  var columns = ['院校代码', '专业代码', '专业名称', '学制', '师范', '艺术', '备注'];
  records.forEach(function (record) {
    (record.school.masterEntries || []).forEach(function (row) {
      Object.keys(row).forEach(function (key) {
        if (key.startsWith('_') || key === '学校名称' || key === '院校名称' || key === '院校代号') return;
        if (columns.indexOf(key) < 0) columns.push(key);
      });
    });
  });
  return columns;
}

function schoolTableRow(record, entry, master, masterColumns) {
  var school = record.school;
  var charter = entry && entry.charterUrl
    ? '<a href="' + esc(entry.charterUrl) + '" target="_blank" rel="noopener noreferrer">查看</a>'
    : '—';
  var more = entry
    ? '<details class="school-table-more"><summary>联系信息</summary><dl>' +
      '<dt>通信地址</dt><dd>' + text(entry.address) + '</dd>' +
      '<dt>咨询电话</dt><dd>' + text(entry.phone) + '</dd>' +
      '<dt>招生章程</dt><dd>' + charter + '</dd>' +
      '</dl></details>'
    : '—';
  var planStatus = school.planPublished === false ? '招生计划未公布' :
    school.fallbackOnly ? '招生计划未单列' : '暂无计划明细';
  var planValues = entry ? [
    text(entry.schoolCode || school.schoolCode), text(entry.majorCode), text(entry.admissionCategory),
    '<span class="school-table-count">' + text(entry.planCount) + '</span>',
    entry.duration == null ? '—' : esc(String(entry.duration)) + ' 年',
    entry.tuition == null ? '—' : '¥' + esc(String(entry.tuition)),
    entry.accommodation == null ? '—' : '¥' + esc(String(entry.accommodation)),
    text(entry.notes) + more
  ] : ['—', '—', planStatus, '—', '—', '—', '—', '—'];
  return '<tr><td>' + record.year + ' 年</td><th scope="row">' + text(school.schoolName) + '</th>' +
    '<td>' + text(school.schoolType) + '</td>' + planValues.map(function (value) { return '<td>' + value + '</td>'; }).join('') +
    masterColumns.map(function (key) {
      var value = master && master[key];
      return '<td>' + (value == null || value === '' ? '—' : text(value)) + '</td>';
    }).join('') + '</tr>';
}

function schoolListTable(records) {
  var masterColumns = schoolTableColumns(records);
  var rows = [];
  records.forEach(function (record) {
    var entries = record.school.planEntries || [];
    var masters = record.school.masterEntries || [];
    var planRows = entries.length ? entries : [null];
    var masterRows = masters.length ? masters : [null];
    planRows.forEach(function (entry) {
      masterRows.forEach(function (master) {
        rows.push(schoolTableRow(record, entry, master, masterColumns));
      });
    });
  });
  if (!rows.length) return '<div class="result-state">所选年份暂无院校招生计划。</div>';
  var planHeadings = ['院校代号', '专业代号', '招生类别', '计划人数', '学制', '学费标准', '最低住宿费', '办学地点/备注及联系'];
  var header = '<thead><tr><th scope="col" rowspan="2">年份</th><th scope="col" rowspan="2">院校名称</th>' +
    '<th scope="col" rowspan="2">办学性质</th><th class="school-table-group" scope="colgroup" colspan="' + planHeadings.length + '">招生计划</th>' +
    '<th class="school-table-group" scope="colgroup" colspan="' + masterColumns.length + '">招生高校及专业总表</th></tr><tr>' +
    planHeadings.map(function (heading) { return '<th scope="col">' + esc(heading) + '</th>'; }).join('') +
    masterColumns.map(function (heading) { return '<th scope="col">' + esc(heading) + '</th>'; }).join('') +
    '</tr></thead>';
  return '<div class="school-comparison-table-view"><div class="school-comparison-table-scroll"><table class="school-comparison-table" aria-label="院校与招生计划对照表">' +
    header + '<tbody>' + rows.join('') + '</tbody></table></div></div>';
}

export function buildSchoolDetailHtml(school, year, hiddenFields) {
  var entries = school.planEntries || [];
  var masterEntries = school.masterEntries || [];
  var planPublished = school.planPublished !== false;
  var yearLabel = year == null ? '' : '<span class="school-year-badge">' + esc(String(year)) + ' 年</span>';
  var schoolCode = school.schoolCode ? '<span class="school-type">代码 ' + esc(String(school.schoolCode)) + '</span>' : '';
  var records = entries.map(planRecordHtml).join('') + masterEntries.map(masterRecordHtml).join('');
  if (!records) records = '<p class="school-detail-empty">' +
    (planPublished ? '暂无招生计划明细。' : '招生计划尚未公布。') + '</p>';
  return '<article class="school-detail">' +
    '<header><h5>' + esc(school.schoolName || '') + '</h5>' + schoolCode + yearLabel +
    '<span class="school-type">' + esc(school.schoolType || '—') + '</span></header>' +
    '<p class="school-plan-summary">' + (!planPublished ? '计划人数未公布' : school.fallbackOnly ? '招生计划未单列' : '普通计划 ' + (school.ordinaryPlanCount || 0) + ' 人') +
    (planPublished && !school.fallbackOnly && resultFieldVisible(hiddenFields, 'povertyPlan') ? ' · 建档立卡专项 ' + (school.povertyPlanCount || 0) + ' 人' : '') + '</p>' +
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
  var groupedRecords = Array.from(groups.values());
  var flattenedRecords = groupedRecords.reduce(function (all, records) { return all.concat(records); }, []);
  return '<div class="school-comparison-cards"><div class="school-comparison-list">' + groupedRecords.map(function (records) {
    return '<section class="school-comparison-card">' + records.map(function (record) {
      return buildSchoolDetailHtml(record.school, record.year, hiddenFields);
    }).join('') + '</section>';
  }).join('') + '</div></div>' + schoolListTable(flattenedRecords);
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
