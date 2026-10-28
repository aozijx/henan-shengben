import { admissionSchoolKey } from './utils.js';

function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, '');
}

function schoolCountLimit(value) {
  if (value == null || value === '') return null;
  var text = String(value);
  return /^\d+$/.test(text) ? Number(text) : null;
}

function scoreBound(value) {
  if (value == null || value === '') return null;
  return /^\d+$/.test(String(value)) ? Number(value) : null;
}

function rowMatchesStaticFilters(row, filters) {
  if (filters.publicCourse && filters.publicCourse !== '全部' && row.publicCourse !== filters.publicCourse) return false;
  if (filters.subject && filters.subject !== '全部' &&
      normalizeText(row.subject) !== normalizeText(filters.subject)) return false;
  return true;
}

function rowMatchesYearFilters(row, filters, year) {
  var minScore = scoreBound(filters.scoreMin);
  var maxScore = scoreBound(filters.scoreMax);
  if (minScore != null && maxScore != null && minScore > maxScore) return false;
  var score = year == null ? null : row['score' + year];
  if (minScore != null && (score == null || score < minScore)) return false;
  if (maxScore != null && (score == null || score > maxScore)) return false;
  var limit = schoolCountLimit(filters.schoolCount);
  if (limit != null && year != null && (row['schoolCount' + year] || 0) <= limit) return false;
  return true;
}

function rowMatchesPlan(row, filters) {
  var type = row['办学性质'] || (row._planUnpublished ? '未标注' : '公办');
  var poverty = row['建档立卡'] || '否';
  if (filters.schoolType && filters.schoolType !== '全部' && type !== filters.schoolType) return false;
  /* 「否」只看普通计划；「是」与「全部」都包含普通+专项（人数合计），专项人数另计入 povertyPlanCount */
  if (filters.povertyStatus === '否' && poverty === '是') return false;
  return true;
}

function allowsUnpublishedMajor(filters) {
  return (!filters.schoolType || filters.schoolType === '全部') &&
    (!filters.povertyStatus || filters.povertyStatus === '全部' || filters.povertyStatus === '否') &&
    schoolCountLimit(filters.schoolCount) == null &&
    scoreBound(filters.scoreMin) == null && scoreBound(filters.scoreMax) == null;
}

function allSchoolsFor(publicSchools, privateSchools) {
  var merged = {};
  Object.keys(publicSchools).forEach(function (s) { merged[s] = true; });
  Object.keys(privateSchools).forEach(function (s) { merged[s] = true; });
  return merged;
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
      publicCourse: normalizeText(major['考试科目']).indexOf('专业英语') >= 0 ? '专业英语' : '公共英语',
      originalOrder: originalOrder
    };
    var latestSchools = {};
    var hasPlans = false;
    var hadAnyPlan = false;
    var matchingYears = [];

    if (!rowMatchesStaticFilters(row, filters)) return;

    years.forEach(function (year) {
      var publicSchools = {}, privateSchools = {}, unclassifiedSchools = {};
      var publicPlan = 0, privatePlan = 0, planCount = 0;
      var publicPovertyPlan = 0, privatePovertyPlan = 0, povertyPlanCount = 0;
      var hasPlansForYear = false;
      var sourcePlans = input.getPlans(major, year) || [];
      if (sourcePlans.length) hadAnyPlan = true;
      sourcePlans.forEach(function (planRow) {
        if (!rowMatchesPlan(planRow, filters)) return;
        var count = Number(planRow['计划人数']) || 0;
        if (filters.povertyStatus === '否' && count <= 0 && !planRow._planUnpublished) return;
        hasPlans = true;
        hasPlansForYear = true;
        var school = admissionSchoolKey(planRow);
        var isPrivate = planRow['办学性质'] === '民办';
        var isPoverty = planRow['建档立卡'] === '是';
        if (school) {
          if (planRow._planUnpublished) unclassifiedSchools[school] = true;
          else if (isPrivate) privateSchools[school] = true; else publicSchools[school] = true;
        }
        if (isPoverty) {
          if (isPrivate) privatePovertyPlan += count; else publicPovertyPlan += count;
          povertyPlanCount += count;
        } else {
          if (isPrivate) privatePlan += count; else publicPlan += count;
          planCount += count;
        }
      });
      var score = input.getScore(major, year);
      row['score' + year] = score == null ? null : Number(score);
      row['publicSchoolCount' + year] = Object.keys(publicSchools).length;
      row['privateSchoolCount' + year] = Object.keys(privateSchools).length;
      row['unclassifiedSchoolCount' + year] = Object.keys(unclassifiedSchools).length;
      row['schoolCount' + year] = row['publicSchoolCount' + year] + row['privateSchoolCount' + year] + row['unclassifiedSchoolCount' + year];
      row['schoolSplit' + year] = row['publicSchoolCount' + year] + '/' + row['privateSchoolCount' + year];
      var planPublished = !input.planPublishedByYear || input.planPublishedByYear[year] !== false;
      row['planCount' + year] = planPublished ? planCount : null;
      row['povertyPlanCount' + year] = planPublished ? povertyPlanCount : null;
      row['planSplit' + year] = planPublished ? publicPlan + '/' + privatePlan : '未公布';
      row['povertyPlanSplit' + year] = planPublished ? publicPovertyPlan + '/' + privatePovertyPlan : '未公布';
      if (year === latestYear) latestSchools = allSchoolsFor(allSchoolsFor(publicSchools, privateSchools), unclassifiedSchools);
      if (hasPlansForYear && rowMatchesYearFilters(row, filters, year)) matchingYears.push(year);
    });

    if (!hasPlans && (hadAnyPlan || !allowsUnpublishedMajor(filters))) return;
    if (hasPlans && !matchingYears.length) return;
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
