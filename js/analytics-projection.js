import { selectMajorRows } from './major-match.js';

function code(value) { return String(value == null ? '' : value).trim(); }

export function projectAnalytics(analyticsByYear, mapping, selectedYears, filters, candidateMajors) {
  var years = (selectedYears || []).slice().sort(function (a, b) { return a - b; });
  var focusYear = years[years.length - 1] || null;
  var options = new Map();
  (candidateMajors == null ? (mapping || []).flatMap(function (entry) { return entry['可报本科专业'] || []; }) : candidateMajors)
    .forEach(function (major) {
      var key = code(major['专业代号']);
      if (key) options.set(key + '|' + major['专业名称'], major);
    });
  var rows = Array.from(options, function ([_identity, major]) {
    var majorCode = code(major['专业代号']);
    var subject = major['考试科目'] || '';
    if (filters && filters.subject && filters.subject !== '全部' &&
        subject.replace(/\s/g, '') !== filters.subject.replace(/\s/g, '')) return null;
    var values = {};
    var present = false;
    years.forEach(function (year) {
      var annualMajors = ((analyticsByYear[year] || {}).majors || []);
      var found = selectMajorRows(annualMajors, majorCode, major['专业名称'],
        function (item) { return item.majorCode; },
        function (item) { return item.majorName; })[0];
      if (!found) { values[year] = null; return; }
      var types = found.schoolTypes || {};
      var included = filters && filters.schoolType === '公办' ? ['public']
        : filters && filters.schoolType === '民办' ? ['private'] : ['public', 'private'];
      var schools = 0, plans = 0, ordinary = 0, poverty = 0;
      var splits = {};
      included.forEach(function (type) {
        var part = types[type] || {};
        var count = filters && filters.povertyStatus === '否' ? (part.ordinarySchoolCount || 0) : (part.allSchoolCount || 0);
        schools += count;
        splits[type] = { schoolCount: count, ordinaryPlanCount: part.ordinaryPlanCount || 0,
          povertyPlanCount: filters && filters.povertyStatus === '否' ? 0 : (part.povertyPlanCount || 0) };
        ordinary += part.ordinaryPlanCount || 0;
        poverty += part.povertyPlanCount || 0;
      });
      plans = ordinary + (filters && filters.povertyStatus === '否' ? 0 : poverty);
      var score = found.controlScore;
      values[year] = { score: score, schoolCount: schools, planCount: plans,
        ordinaryPlanCount: ordinary, povertyPlanCount: filters && filters.povertyStatus === '否' ? 0 : poverty,
        schoolTypes: splits };
      if (schools > 0) present = true;
    });
    if (!present) return null;
    var min = filters && filters.scoreMin !== '' ? Number(filters.scoreMin) : null;
    var max = filters && filters.scoreMax !== '' ? Number(filters.scoreMax) : null;
    var validLimit = filters && /^\d+$/.test(String(filters.schoolCount == null ? '' : filters.schoolCount));
    var limit = validLimit ? Number(filters.schoolCount) : null;
    if (validLimit &&
        !years.some(function (year) { return values[year] && values[year].schoolCount > limit; })) return null;
    if (filters && (filters.scoreMin || filters.scoreMax) && !years.some(function (year) {
      var score = values[year] && values[year].score;
      return score != null && (min == null || score >= min) && (max == null || score <= max);
    })) return null;
    return { majorCode: majorCode, majorName: major['专业名称'], subject: subject, years: values };
  }).filter(Boolean);
  return { years: years, focusYear: focusYear, majors: rows };
}
