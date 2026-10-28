/* Lightweight annual summaries in the shape consumed by the existing preview
   and aggregate pipeline. These rows are never shown as detailed plan records. */
import { normalizeCollegeMasterRow } from './model.js';
export function queryRowsFromAnalytics(analyticsByYear, years) {
  var scoresByYear = {}, plansByYear = {};
  (years || []).forEach(function (year) {
    var majors = ((analyticsByYear[year] || {}).majors || []);
    scoresByYear[year] = majors.map(function (major) {
      return { '专业代号': major.majorCode, '专业名称': major.majorName, '分数线': major.controlScore };
    });
    plansByYear[year] = majors.flatMap(function (major) {
      return ['public', 'private'].flatMap(function (type) {
        var schoolType = type === 'public' ? '公办' : '民办';
        return (((major.schoolTypes || {})[type] || {}).schools || []).flatMap(function (school) {
          var base = { '年度': year, '专业代号': major.majorCode, '专业名称': major.majorName,
            '院校名称': school.schoolName, '院校代号': school.schoolCode || '',
            '办学性质': schoolType, _summaryOnly: true };
          var rows = [];
          if (school.hasOrdinaryPlan) rows.push({ ...base, '招生类别': '普通专升本', '建档立卡': '否',
            '计划人数': school.ordinaryPlanCount });
          if (school.hasPovertyPlan) rows.push({ ...base, '招生类别': '建档立卡专项', '建档立卡': '是',
            '计划人数': school.povertyPlanCount });
          return rows;
        });
      });
    });
  });
  return { years: (years || []).slice(), scoresByYear: scoresByYear, plansByYear: plansByYear,
    fallbacksByYear: {} };
}

export function queryRowsFromPublishedSources(analyticsByYear, collegeByYear, years) {
  var completeYears = (years || []).filter(function (year) { return Boolean(analyticsByYear[year]); });
  var result = queryRowsFromAnalytics(analyticsByYear, completeYears);
  result.years = (years || []).slice();
  result.planPublishedByYear = {};
  result.scorePublishedByYear = {};
  (years || []).forEach(function (year) {
    var source = collegeByYear[year] || { plans: [], colleges: [], planPublished: false };
    result.fallbacksByYear[year] = (source.colleges || []).map(function (row) {
      return normalizeCollegeMasterRow(row, Boolean(analyticsByYear[year]) || source.planPublished);
    });
    if (analyticsByYear[year]) {
      result.planPublishedByYear[year] = true;
      result.scorePublishedByYear[year] = true;
      return;
    }
    result.scoresByYear[year] = source.scores || [];
    result.plansByYear[year] = source.plans;
    result.planPublishedByYear[year] = source.planPublished;
    result.scorePublishedByYear[year] = source.scorePublished === true;
  });
  return result;
}
