import { getFocusYear, normalizeSelectedYears } from './metadata.js';
import { sortPreviewRows } from './pipeline.js';
import { hasMasterMarkFilter, matchesMasterMarks } from './master-flags.js';
import { excludesPovertyPlans, matchesSchoolType, isPovertyPlan } from './plan-filter.js';

function numberOrNull(value) {
  if (value == null || value === '') return null;
  var number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function summaryFor(schools, type) {
  return (schools || []).filter(function (school) { return school.schoolType === type; })
    .reduce(function (summary, school) {
      summary.schoolCount += 1;
      summary.ordinaryPlanCount += Number(school.ordinaryPlanCount) || 0;
      summary.povertyPlanCount += Number(school.povertyPlanCount) || 0;
      return summary;
    }, { schoolCount: 0, ordinaryPlanCount: 0, povertyPlanCount: 0 });
}

function planCount(entry) {
  return Number(entry && (entry.planCount == null ? entry['计划人数'] : entry.planCount)) || 0;
}

export function filterYear(yearAggregate, filters, metadata) {
  if ((!filters.schoolType || filters.schoolType === '全部') &&
      (!filters.povertyStatus || filters.povertyStatus === '全部') &&
      !hasMasterMarkFilter(filters, metadata)) return yearAggregate;
  var schools = (yearAggregate && yearAggregate.schools || []).map(function (school) {
    if (!matchesSchoolType(school.schoolType, filters)) return false;
    if (hasMasterMarkFilter(filters, metadata) && !(school.masterEntries || []).some(function (row) {
      return matchesMasterMarks(row, filters, metadata);
    })) return false;
    var entries = Array.isArray(school.planEntries) ? school.planEntries : [];
    var visibleEntries = excludesPovertyPlans(filters) ? entries.filter(function (entry) { return !isPovertyPlan(entry); }) : entries;
    var ordinaryPlanCount = visibleEntries.length
      ? visibleEntries.reduce(function (sum, entry) { return sum + (isPovertyPlan(entry) ? 0 : planCount(entry)); }, 0)
      : Number(school.ordinaryPlanCount) || 0;
    if (excludesPovertyPlans(filters) && ordinaryPlanCount <= 0 && !school.fallbackOnly &&
        yearAggregate.planPublished !== false) return false;
    return {
      ...school,
      planEntries: visibleEntries,
      ordinaryPlanCount: ordinaryPlanCount,
      povertyPlanCount: visibleEntries.length ? visibleEntries.filter(isPovertyPlan).reduce(function (sum, entry) { return sum + planCount(entry); }, 0) : (excludesPovertyPlans(filters) ? 0 : Number(school.povertyPlanCount) || 0)
    };
  }).filter(Boolean);
  return {
    ...yearAggregate,
    schools: schools,
    publicSummary: summaryFor(schools, '公办'),
    privateSummary: summaryFor(schools, '民办')
  };
}

function matchesStaticFilters(aggregate, filters) {
  var major = aggregate.major || {};
  var course = major.professionalCourse || {};
  if (filters.publicCourse && filters.publicCourse !== '全部' && major.publicCourse !== filters.publicCourse) return false;
  return !filters.subject || filters.subject === '全部' || String(course.name || '').replace(/\s+/g, '') === String(filters.subject).replace(/\s+/g, '');
}

function matchesYearFilters(yearAggregate, filters) {
  var min = filters.scoreMin === '' || filters.scoreMin == null ? null : numberOrNull(filters.scoreMin);
  var max = filters.scoreMax === '' || filters.scoreMax == null ? null : numberOrNull(filters.scoreMax);
  if (min != null && max != null && min > max) return false;
  var score = numberOrNull(yearAggregate.score);
  if (min != null && (score == null || score < min)) return false;
  if (max != null && (score == null || score > max)) return false;
  var limit = filters.schoolCount === '' || filters.schoolCount == null ? null : numberOrNull(filters.schoolCount);
  var count = (yearAggregate.schools || []).length;
  if (limit != null && count <= limit) return false;
  return yearAggregate.schools.length > 0;
}

function projectAggregate(aggregate, years) {
  var major = aggregate.major || {};
  var course = major.professionalCourse || {};
  var row = {
    majorName: major.majorName || '',
    publicCourse: major.publicCourse || '',
    subject: course.name || '',
    originalOrder: aggregate.originalOrder
  };
  years.forEach(function (year) {
    var value = aggregate.years[year];
    var pub = value.publicSummary || {};
    var priv = value.privateSummary || {};
    var publicSchools = pub.schoolCount || 0;
    var privateSchools = priv.schoolCount || 0;
    var unclassifiedSchools = Math.max(0, value.schools.length - publicSchools - privateSchools);
    var publicPlan = pub.ordinaryPlanCount || 0;
    var privatePlan = priv.ordinaryPlanCount || 0;
    var publicPoverty = pub.povertyPlanCount || 0;
    var privatePoverty = priv.povertyPlanCount || 0;
    var listedPlans = value.schools.some(function (school) { return !school.fallbackOnly; });
    var unlistedMaster = value.schools.some(function (school) { return school.fallbackOnly; });
    row['score' + year] = value.score == null ? null : Number(value.score);
    row['publicSchoolCount' + year] = publicSchools;
    row['privateSchoolCount' + year] = privateSchools;
    row['unclassifiedSchoolCount' + year] = unclassifiedSchools;
    row['schoolCount' + year] = value.schools.length;
    row['schoolSplit' + year] = publicSchools + '/' + privateSchools +
      (unclassifiedSchools ? ' · 未标注 ' + unclassifiedSchools : '');
    row['planCount' + year] = value.planPublished === false || !listedPlans ? null : publicPlan + privatePlan;
    row['povertyPlanCount' + year] = value.planPublished === false || !listedPlans ? null : publicPoverty + privatePoverty;
    row['planSplit' + year] = value.planPublished === false ? '未公布' : !listedPlans ? '未单列' :
      publicPlan + '/' + privatePlan + (unlistedMaster ? ' · 其余未单列' : '');
    row['povertyPlanSplit' + year] = value.planPublished === false ? '未公布' : !listedPlans ? '未单列' :
      publicPoverty + '/' + privatePoverty + (unlistedMaster ? ' · 其余未单列' : '');
  });
  return row;
}

export function buildResultModel(input) {
  var metadata = input.metadata || { supportedYears: input.selectedYears || [] };
  var selectedYears = normalizeSelectedYears(input.selectedYears, metadata);
  var filters = input.filters || {};
  var selected = (input.aggregates || []).map(function (aggregate, originalOrder) {
    var years = {};
    var hadSchools = selectedYears.some(function (year) {
      return (((aggregate.years || {})[year] || {}).schools || []).length > 0;
    });
    selectedYears.forEach(function (year) {
      years[year] = filterYear((aggregate.years || {})[year] || { score: null, schools: [] }, filters, metadata);
    });
    return { ...aggregate, hadSchools: hadSchools,
      originalOrder: aggregate.originalOrder == null ? originalOrder : aggregate.originalOrder, years: years };
  }).filter(function (aggregate) {
    if (!matchesStaticFilters(aggregate, filters)) return false;
    if (selectedYears.some(function (year) { return matchesYearFilters(aggregate.years[year], filters); })) return true;
    if (aggregate.hadSchools) return false;
    return (!filters.schoolType || filters.schoolType === '全部') &&
      (!filters.povertyStatus || filters.povertyStatus === '全部' || filters.povertyStatus === '否') &&
      !hasMasterMarkFilter(filters, metadata) &&
      (filters.schoolCount == null || filters.schoolCount === '') &&
      (filters.scoreMin == null || filters.scoreMin === '') &&
      (filters.scoreMax == null || filters.scoreMax === '');
  });
  var allRows = sortPreviewRows(selected.map(function (aggregate) { return projectAggregate(aggregate, selectedYears); }), input.sort);
  var focusYear = getFocusYear(selectedYears, metadata);
  var schools = {};
  selected.forEach(function (aggregate) {
    ((aggregate.years[focusYear] || {}).schools || []).forEach(function (school) { schools[school.schoolId || school.schoolName] = true; });
  });
  return {
    aggregates: selected,
    allRows: allRows,
    selectedYears: selectedYears,
    focusYear: focusYear,
    effectiveSchoolCount: Object.keys(schools).length,
    effectiveSchoolYear: focusYear
  };
}
