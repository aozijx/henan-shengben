import { selectMajorRows } from './major-match.js';
import { admissionSchoolKey } from './utils.js';

function numberOrNull(value) {
  if (value == null || value === '') return null;
  var number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function codeOf(value) {
  return String(value == null ? '' : value).trim();
}

function aliases(code) {
  var value = codeOf(code);
  if (value === '99') return ['99', 'A1'];
  if (value === 'A1') return ['A1', '99'];
  return [value];
}

function belongsToMajor(row, major) {
  var rowCode = codeOf(row.majorCode == null ? row['专业代号'] : row.majorCode);
  if (rowCode && aliases(major.majorCode).includes(rowCode)) return true;
  var rowName = String(row.majorName == null ? row['专业名称'] || '' : row.majorName).trim();
  return Boolean(rowName && rowName === major.majorName);
}

function valuesForYear(collection, year) {
  var value = collection && collection[year];
  if (Array.isArray(value)) return value;
  return value && Array.isArray(value.majors) ? value.majors : [];
}

function planRowsForMajor(collection, year, major) {
  var rows = valuesForYear(collection, year);
  return selectMajorRows(rows, major.majorCode, major.majorName,
    function (row) { return row.majorCode == null ? row['专业代号'] : row.majorCode; },
    function (row) { return row.majorName == null ? row['专业名称'] : row.majorName; });
}

function cumulativeAt(series, target) {
  if (!series || target == null || !Array.isArray(series.segments) || !series.segments.length) return null;
  var sorted = series.segments.slice().sort(function (a, b) { return Number(b.score) - Number(a.score); });
  var cumulative = 0;
  for (var i = 0; i < sorted.length; i += 1) {
    var segmentScore = numberOrNull(sorted[i].score);
    if (segmentScore == null) continue;
    if (segmentScore < target) break;
    cumulative = numberOrNull(sorted[i].cumulativeCount);
  }
  return cumulative;
}

export function resolveScoreContext(series, score, controlScore) {
  var normalizedScore = numberOrNull(score);
  var normalizedControl = numberOrNull(controlScore);
  return {
    score: normalizedScore,
    controlScore: normalizedControl,
    scoreDifference: normalizedScore == null || normalizedControl == null ? null : normalizedScore - normalizedControl,
    cumulativeCount: cumulativeAt(series, normalizedScore),
    controlCumulativeCount: cumulativeAt(series, normalizedControl)
  };
}

function schoolType(row) {
  return String(row.schoolType || row['办学性质'] || '公办').trim() || '公办';
}

function createSchool(row) {
  return {
    schoolId: admissionSchoolKey(row),
    schoolName: String(row.schoolName || row['院校名称'] || admissionSchoolKey(row)).trim(),
    schoolCode: String(row.schoolCode || row['院校代号'] || '').trim(),
    schoolType: schoolType(row),
    ordinaryPlanCount: 0,
    povertyPlanCount: 0,
    planEntries: [],
    fallbackOnly: true
  };
}

function addSchool(schools, row, isFallback) {
  var identity = admissionSchoolKey(row);
  if (!identity) return;
  var school = schools.get(identity);
  if (!school) {
    school = createSchool(row);
    schools.set(identity, school);
  }
  if (isFallback) return;
  var count = numberOrNull(row.planCount == null ? row['计划人数'] : row.planCount) || 0;
  var poverty = row.povertyStatus === '是' || row['建档立卡'] === '是' || /建档立卡/.test(String(row.admissionCategory || row['招生类别'] || ''));
  if (poverty) school.povertyPlanCount += count;
  else school.ordinaryPlanCount += count;
  school.planEntries.push(row);
  school.fallbackOnly = false;
}

function summarize(schools, type) {
  var selected = schools.filter(function (school) { return school.schoolType === type; });
  return selected.reduce(function (summary, school) {
    summary.ordinaryPlanCount += school.ordinaryPlanCount;
    summary.povertyPlanCount += school.povertyPlanCount;
    return summary;
  }, { schoolCount: selected.length, ordinaryPlanCount: 0, povertyPlanCount: 0 });
}

function scoreValue(row) {
  return numberOrNull(row && (row.score == null ? row['分数线'] : row.score));
}

export function buildMajorAggregates(input) {
  var years = (input.years || []).slice().sort(function (a, b) { return a - b; });
  return (input.majors || []).map(function (major, originalOrder) {
    var aggregate = { major: major, originalOrder: originalOrder, years: {} };
    years.forEach(function (year) {
      var planRows = planRowsForMajor(input.plansByYear, year, major);
      var fallbackRows = planRowsForMajor(input.fallbacksByYear, year, major);
      var scoreRow = valuesForYear(input.scoresByYear, year).find(function (row) { return belongsToMajor(row, major); }) || null;
      var series = valuesForYear(input.segmentsByYear, year).find(function (row) { return belongsToMajor(row, major); }) || null;
      var schools = new Map();
      planRows.forEach(function (row) { addSchool(schools, row, false); });
      fallbackRows.forEach(function (row) { addSchool(schools, row, true); });
      var schoolList = Array.from(schools.values());
      var score = scoreValue(scoreRow);
      var controlScore = numberOrNull(series && series.controlScore);
      if (controlScore == null) controlScore = score;
      aggregate.years[year] = {
        year: year,
        score: score,
        scoreContext: resolveScoreContext(series, null, controlScore),
        publicSummary: summarize(schoolList, '公办'),
        privateSummary: summarize(schoolList, '民办'),
        schools: schoolList,
        scoreSegments: series
      };
    });
    return aggregate;
  });
}
