import { estimateMinimumScore } from './aggregate.js';
import { lookupScoreSegmentCode } from './score-curves.js';

export async function loadEstimatedScores(aggregates, years, metadata, repository) {
  if (!aggregates || !aggregates.length) return [];
  var sources = metadata && metadata.yearSources || {};
  var availableYears = (years || []).filter(function (year) {
    return sources[year] && sources[year].scoreSegmentIndexSource && sources[year].scoreSegmentShardTemplate;
  });
  var indexes = await Promise.all(availableYears.map(function (year) {
    return repository.ensureScoreSegmentIndex(year).catch(function () { return null; });
  }));
  var indexByYear = Object.fromEntries(availableYears.map(function (year, index) { return [year, indexes[index]]; }));
  return Promise.all(aggregates.map(async function (aggregate) {
    var yearEntries = await Promise.all((years || []).map(async function (year) {
      var value = aggregate.years && aggregate.years[year];
      if (!value) return [year, value];
      var seats = value.planPublished === false ? 0 : (value.schools || []).reduce(function (total, school) {
        return total + (Number(school.ordinaryPlanCount) || 0);
      }, 0);
      var code = seats > 0 ? lookupScoreSegmentCode(indexByYear[year], aggregate.major && aggregate.major.majorCode) : null;
      var series = code ? await repository.ensureScoreSegment(year, code).catch(function () { return null; }) : null;
      return [year, { ...value, estimatedMinScore: estimateMinimumScore(series, seats) }];
    }));
    return { ...aggregate, years: { ...aggregate.years, ...Object.fromEntries(yearEntries) } };
  }));
}
