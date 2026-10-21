function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, '');
}

function schoolCountLimit(value) {
  if (value == null || value === '') return null;
  var text = String(value);
  return /^\d+$/.test(text) ? Number(text) : null;
}

function rowMatchesFilters(row, filters) {
  if (filters.subject && filters.subject !== '全部' &&
      normalizeText(row.subject) !== normalizeText(filters.subject)) return false;
  var limit = schoolCountLimit(filters.schoolCount);
  if (limit != null && row.schoolCount > limit) return false;
  return true;
}

function rowMatchesPlan(row, filters) {
  var type = row['办学性质'] || '公办';
  var poverty = row['建档立卡'] || '否';
  if (filters.schoolType && filters.schoolType !== '全部' && type !== filters.schoolType) return false;
  if (filters.povertyStatus && filters.povertyStatus !== '全部' && poverty !== filters.povertyStatus) return false;
  return true;
}

export function buildPreviewRows(input) {
  var filters = input.filters || {};
  var effectiveSchools = {};
  var rows = [];

  (input.majors || []).forEach(function (major, originalOrder) {
    var score = input.getScore(major, input.year);
    var planRows = (input.getPlans(major, input.year) || []).filter(function (row) {
      return rowMatchesPlan(row, filters);
    });
    if (!planRows.length) return;

    var publicSchools = {}, privateSchools = {}, allSchools = {};
    var planCount = 0;
    planRows.forEach(function (row) {
      var school = row['院校名称'] || row['学校名称'] || '';
      var isPrivate = row['办学性质'] === '民办';
      if (school) {
        allSchools[school] = true;
        if (isPrivate) privateSchools[school] = true; else publicSchools[school] = true;
      }
      planCount += Number(row['计划人数']) || 0;
    });
    var row = {
      majorName: major['专业名称'] || '',
      subject: major['考试科目'] || '',
      score: score == null ? null : Number(score),
      publicSchoolCount: Object.keys(publicSchools).length,
      privateSchoolCount: Object.keys(privateSchools).length,
      schoolCount: Object.keys(allSchools).length,
      planCount: planCount,
      originalOrder: originalOrder,
      major: major,
      planRows: planRows
    };
    if (!rowMatchesFilters(row, filters)) return;
    Object.keys(allSchools).forEach(function (school) { effectiveSchools[school] = true; });
    rows.push(row);
  });

  return { rows: rows, effectiveSchoolCount: Object.keys(effectiveSchools).length };
}

export function sortPreviewRows(rows, sort) {
  var key = sort && sort.key ? sort.key : 'originalOrder';
  var direction = sort && sort.direction ? sort.direction : 'original';
  if (direction === 'original' || key === 'originalOrder') {
    return rows.slice().sort(function (a, b) { return a.originalOrder - b.originalOrder; });
  }
  var factor = direction === 'desc' ? -1 : 1;
  return rows.slice().sort(function (a, b) {
    var aValue = a[key], bValue = b[key];
    if (aValue == null && bValue == null) return a.originalOrder - b.originalOrder;
    if (aValue == null) return 1;
    if (bValue == null) return -1;
    var comparison = typeof aValue === 'string'
      ? aValue.localeCompare(bValue, 'zh-CN')
      : aValue - bValue;
    return comparison === 0 ? a.originalOrder - b.originalOrder : comparison * factor;
  });
}
