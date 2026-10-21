function scoreField(metadata) {
  return (metadata.fields || []).find(function (field) { return field.key === 'score'; }) || {};
}

function parseBound(value, label, field) {
  if (value == null || value === '') return { value: null };
  var text = String(value);
  if (!/^\d+$/.test(text)) return { error: label + '只能输入非负整数' };
  var number = Number(text);
  if (!Number.isSafeInteger(number)) return { error: label + '超出有效范围' };
  if (Number.isFinite(field.min) && number < field.min) return { error: label + '不能低于 ' + field.min };
  if (Number.isFinite(field.max) && number > field.max) return { error: label + '不能高于 ' + field.max };
  return { value: number };
}

export function validateScoreRange(filters, metadata) {
  var field = scoreField(metadata || { fields: [] });
  var minResult = parseBound(filters.minScore, '最低分', field);
  if (minResult.error) return { valid: false, error: minResult.error, min: null, max: null };
  var maxResult = parseBound(filters.maxScore, '最高分', field);
  if (maxResult.error) return { valid: false, error: maxResult.error, min: null, max: null };
  if (minResult.value != null && maxResult.value != null && minResult.value > maxResult.value) {
    return { valid: false, error: '最低分不能高于最高分', min: minResult.value, max: maxResult.value };
  }
  return { valid: true, error: '', min: minResult.value, max: maxResult.value };
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
  var bounds = validateScoreRange(filters, input.metadata || { fields: [{ key: 'score', type: 'number' }] });
  if (!bounds.valid) throw new Error(bounds.error);
  var effectiveSchools = {};
  var rows = [];

  (input.majors || []).forEach(function (major, originalOrder) {
    var score = input.getScore(major, input.year);
    if (bounds.min != null && (score == null || score < bounds.min)) return;
    if (bounds.max != null && (score == null || score > bounds.max)) return;
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
        effectiveSchools[school] = true;
        if (isPrivate) privateSchools[school] = true; else publicSchools[school] = true;
      }
      planCount += Number(row['计划人数']) || 0;
    });
    rows.push({
      majorName: major['专业名称'] || '',
      score: score == null ? null : Number(score),
      publicSchoolCount: Object.keys(publicSchools).length,
      privateSchoolCount: Object.keys(privateSchools).length,
      schoolCount: Object.keys(allSchools).length,
      planCount: planCount,
      originalOrder: originalOrder,
      major: major,
      planRows: planRows
    });
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
