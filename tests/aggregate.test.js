import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMajorAggregates, resolveScoreContext } from '../js/aggregate.js';

const major = {
  majorId: '080902', majorName: '软件工程', majorCode: '80',
  publicCourse: '公共英语', professionalCourse: { code: '02', name: '高等数学' }
};

test('keeps ordinary and poverty admission codes separate for the same school name', () => {
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
  assert.equal(year.schools.length, 4);
  assert.equal(year.schools.find((school) => school.schoolCode === '6001').ordinaryPlanCount, 20);
  assert.equal(year.schools.find((school) => school.schoolCode === '6401').povertyPlanCount, 3);
  assert.deepEqual(year.publicSummary, { schoolCount: 3, ordinaryPlanCount: 20, povertyPlanCount: 3 });
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

test('attaches only exact master major and school records while keeping unmatched schools separate', () => {
  const item = { ...major, disciplineCode6: '080902' };
  const year = buildMajorAggregates({ majors: [item], years: [2027],
    plansByYear: { 2027: [{ majorCode: '80', majorName: '软件工程', schoolCode: '6001',
      schoolName: '甲大学', schoolType: '公办', povertyStatus: '否', planCount: 20 }] },
    fallbacksByYear: { 2027: [
      { 专业代码: '080902', 专业名称: '软件工程', 院校代号: '10001', 院校名称: '甲大学',
        师范: '是', 艺术: '', 学制: '2年', 备注: '就读地点：主校区', 办学性质: '未标注' },
      { 专业代码: '080902', 专业名称: '软件工程', 院校代号: '10002', 院校名称: '乙大学',
        师范: '', 艺术: '是', 学制: '3年', 备注: '', 办学性质: '未标注' },
      { 专业代码: '080903', 专业名称: '软件工程', 院校代号: '10003', 院校名称: '丙大学',
        师范: '是', 艺术: '是', 学制: '2年', 备注: '', 办学性质: '未标注' }
    ] }
  })[0].years[2027];
  assert.deepEqual(year.schools.map((school) => school.schoolName), ['甲大学', '乙大学']);
  assert.equal(year.schools[0].masterEntries[0]['师范'], '是');
  assert.equal(year.schools[0].ordinaryPlanCount, 20);
  assert.equal(year.schools[1].fallbackOnly, true);
  assert.equal(year.schools[1].masterEntries[0]['艺术'], '是');
});
