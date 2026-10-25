import { getFocusYear, normalizeSelectedYears } from './metadata.js';
import { sortPreviewRows } from './pipeline.js';

function numberOrNull(value) {
  var number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function summaryFor(schools, type) {
  return (schools || []).filter(function (school) { return (school.schoolType || '公办') === type; })
    .reduce(function (summary, school) {
      summary.schoolCount += 1;
      summary.ordinaryPlanCount += Number(school.ordinaryPlanCount) || 0;
      summary.povertyPlanCount += Number(school.povertyPlanCount) || 0;
      return summary;
    }, { schoolCount: 0, ordinaryPlanCount: 0, povertyPlanCount: 0 });
}

function isPovertyPlan(entry) {
  return entry && (entry.povertyStatus === '是' || entry['建档立卡'] === '是' || /建档立卡/.test(String(entry.admissionCategory || entry['招生类别'] || '')));
}

function planCount(entry) {
  return Number(entry && (entry.planCount == null ? entry['计划人数'] : entry.planCount)) || 0;
}

function filterYear(yearAggregate, filters) {
  if ((!filters.schoolType || filters.schoolType === '全部') &&
      (!filters.povertyStatus || filters.povertyStatus === '全部')) return yearAggregate;
  var schools = (yearAggregate && yearAggregate.schools || []).map(function (school) {
    if (filters.schoolType && filters.schoolType !== '全部' && school.schoolType !== filters.schoolType) return false;
    var entries = Array.isArray(school.planEntries) ? school.planEntries : [];
    var visibleEntries = filters.povertyStatus === '否' ? entries.filter(function (entry) { return !isPovertyPlan(entry); }) : entries;
    var ordinaryPlanCount = visibleEntries.length
      ? visibleEntries.reduce(function (sum, entry) { return sum + (isPovertyPlan(entry) ? 0 : planCount(entry)); }, 0)
      : Number(school.ordinaryPlanCount) || 0;
    if (filters.povertyStatus === '否' && ordinaryPlanCount <= 0) return false;
    return {
      ...school,
      planEntries: visibleEntries,
      ordinaryPlanCount: ordinaryPlanCount,
      povertyPlanCount: visibleEntries.length ? visibleEntries.filter(isPovertyPlan).reduce(function (sum, entry) { return sum + planCount(entry); }, 0) : (filters.povertyStatus === '否' ? 0 : Number(school.povertyPlanCount) || 0)
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
  var count = (yearAggregate.publicSummary.schoolCount || 0) + (yearAggregate.privateSummary.schoolCount || 0);
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
    var publicPlan = pub.ordinaryPlanCount || 0;
    var privatePlan = priv.ordinaryPlanCount || 0;
    var publicPoverty = pub.povertyPlanCount || 0;
    var privatePoverty = priv.povertyPlanCount || 0;
    row['score' + year] = value.score == null ? null : Number(value.score);
    row['publicSchoolCount' + year] = publicSchools;
    row['privateSchoolCount' + year] = privateSchools;
    row['schoolCount' + year] = publicSchools + privateSchools;
    row['schoolSplit' + year] = publicSchools + '/' + privateSchools;
    row['planCount' + year] = publicPlan + privatePlan;
    row['povertyPlanCount' + year] = publicPoverty + privatePoverty;
    row['planSplit' + year] = publicPlan + '/' + privatePlan;
    row['povertyPlanSplit' + year] = publicPoverty + '/' + privatePoverty;
  });
  return row;
}

export function buildResultModel(input) {
  var metadata = input.metadata || { supportedYears: input.selectedYears || [] };
  var selectedYears = normalizeSelectedYears(input.selectedYears, metadata);
  var filters = input.filters || {};
  var selected = (input.aggregates || []).map(function (aggregate, originalOrder) {
    var years = {};
    selectedYears.forEach(function (year) {
      years[year] = filterYear((aggregate.years || {})[year] || { score: null, schools: [] }, filters);
    });
    return { ...aggregate, originalOrder: aggregate.originalOrder == null ? originalOrder : aggregate.originalOrder, years: years };
  }).filter(function (aggregate) {
    if (!matchesStaticFilters(aggregate, filters)) return false;
    return selectedYears.some(function (year) { return matchesYearFilters(aggregate.years[year], filters); });
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
