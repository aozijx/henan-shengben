import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMajorAggregates, resolveScoreContext } from '../js/aggregate.js';

const major = {
  majorId: '080902', majorName: '软件工程', majorCode: '80',
  publicCourse: '公共英语', professionalCourse: { code: '02', name: '高等数学' }
};

test('merges ordinary and poverty codes by school while preserving separate plan totals', () => {
  const aggregates = buildMajorAggregates({
    majors: [major],
    years: [2026],
    plansByYear: {
      2026: [
        { year: 2026, majorCode: '80', schoolId: '河南大学', schoolCode: '6001', schoolName: '河南大学', schoolType: '公办', povertyStatus: '否', planCount: 20 },
        { year: 2026, majorCode: '80', schoolId: '河南大学', schoolCode: '6401', schoolName: '河南大学', schoolType: '公办', povertyStatus: '是', planCount: 3 },
        { year: 2026, majorCode: '80', schoolId: '民办学院', schoolCode: '7001', schoolName: '民办学院', schoolType: '民办', povertyStatus: '否', planCount: 10 }
      ]
    },
    scoresByYear: { 2026: [{ majorCode: '80', score: 180 }] },
    segmentsByYear: { 2026: [{ majorCode: '80', controlScore: 180, segments: [{ score: 200, cumulativeCount: 12 }, { score: 180, cumulativeCount: 45 }] }] },
    fallbacksByYear: { 2026: [{ majorCode: '80', schoolId: '补录学校', schoolName: '补录学校', schoolType: '公办' }] }
  });

  const year = aggregates[0].years[2026];
  assert.equal(year.schools.length, 3);
  assert.equal(year.schools.find((school) => school.schoolName === '河南大学').ordinaryPlanCount, 20);
  assert.equal(year.schools.find((school) => school.schoolName === '河南大学').povertyPlanCount, 3);
  assert.deepEqual(year.publicSummary, { schoolCount: 2, ordinaryPlanCount: 20, povertyPlanCount: 3 });
  assert.deepEqual(year.privateSummary, { schoolCount: 1, ordinaryPlanCount: 10, povertyPlanCount: 0 });
  assert.equal(year.schools.find((school) => school.schoolName === '补录学校').ordinaryPlanCount, 0);
  assert.equal(year.scoreContext.controlCumulativeCount, 45);
});

test('resolves cumulative reference counts and score difference without inventing missing scores', () => {
  const series = { segments: [
    { score: 210, cumulativeCount: 4 },
    { score: 200, cumulativeCount: 12 },
    { score: 180, cumulativeCount: 45 }
  ] };

  assert.deepEqual(resolveScoreContext(series, 205, 180), {
    score: 205,
    controlScore: 180,
    scoreDifference: 25,
    cumulativeCount: 4,
    controlCumulativeCount: 45
  });
  assert.deepEqual(resolveScoreContext(null, null, 180), {
    score: null,
    controlScore: 180,
    scoreDifference: null,
    cumulativeCount: null,
    controlCumulativeCount: null
  });
});
