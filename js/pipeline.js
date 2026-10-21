function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, '');
}

function schoolCountLimit(value) {
  if (value == null || value === '') return null;
  var text = String(value);
  return /^\d+$/.test(text) ? Number(text) : null;
}

function rowMatchesFilters(row, filters, latestYear) {
  if (filters.subject && filters.subject !== '全部' &&
      normalizeText(row.subject) !== normalizeText(filters.subject)) return false;
  var limit = schoolCountLimit(filters.schoolCount);
  if (limit != null && latestYear != null && (row['schoolCount' + latestYear] || 0) <= limit) return false;
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
  var years = (input.years || []).slice().sort(function (a, b) { return a - b; });
  var latestYear = years.length ? years[years.length - 1] : null;
  var effectiveSchools = {};
  var rows = [];

  (input.majors || []).forEach(function (major, originalOrder) {
    var row = {
      majorName: major['专业名称'] || '',
      subject: major['考试科目'] || '',
      originalOrder: originalOrder
    };
    var latestSchools = {};
    var hasPlans = false;

    years.forEach(function (year) {
      var publicSchools = {}, privateSchools = {}, allSchools = {};
      var planCount = 0;
      (input.getPlans(major, year) || []).forEach(function (planRow) {
        if (!rowMatchesPlan(planRow, filters)) return;
        hasPlans = true;
        var school = planRow['院校名称'] || planRow['学校名称'] || '';
        var isPrivate = planRow['办学性质'] === '民办';
        if (school) {
          allSchools[school] = true;
          if (isPrivate) privateSchools[school] = true; else publicSchools[school] = true;
        }
        planCount += Number(planRow['计划人数']) || 0;
      });
      var score = input.getScore(major, year);
      row['score' + year] = score == null ? null : Number(score);
      row['publicSchoolCount' + year] = Object.keys(publicSchools).length;
      row['privateSchoolCount' + year] = Object.keys(privateSchools).length;
      row['schoolCount' + year] = Object.keys(allSchools).length;
      row['schoolSplit' + year] = row['publicSchoolCount' + year] + '/' + row['privateSchoolCount' + year];
      row['planCount' + year] = planCount;
      if (year === latestYear) latestSchools = allSchools;
    });

    if (!hasPlans) return;
    if (!rowMatchesFilters(row, filters, latestYear)) return;
    if (latestYear != null) {
      Object.keys(latestSchools).forEach(function (school) { effectiveSchools[school] = true; });
    }
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
