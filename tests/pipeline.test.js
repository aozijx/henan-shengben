import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreviewRows, sortPreviewRows } from '../js/pipeline.js';

const years = [2024, 2025, 2026];

const majors = [
  { 专业名称: '软件工程', 专业代号: '80', 考试科目: '高等数学' },
  { 专业名称: '会计学', 专业代号: '97', 考试科目: '管理学' },
  { 专业名称: '英语', 专业代号: 'C1', 考试科目: '大学语文、专业英语' }
];

const scores = {
  软件工程: { 2024: 170, 2025: 175, 2026: 180 },
  会计学: { 2024: null, 2025: 145, 2026: 150 },
  英语: { 2024: 200, 2025: 205, 2026: 210 }
};
const plans = {
  软件工程: [
    { 院校名称: '甲大学', 办学性质: '公办', 建档立卡: '否', 计划人数: 20 },
    { 院校名称: '甲大学', 办学性质: '公办', 建档立卡: '是', 计划人数: 5 },
    { 院校名称: '乙学院', 办学性质: '民办', 建档立卡: '否', 计划人数: 30 }
  ],
  会计学: [
    { 院校名称: '乙学院', 办学性质: '民办', 建档立卡: '是', 计划人数: 10 }
  ],
  英语: [
    { 院校名称: '丙大学', 办学性质: '公办', 建档立卡: '否', 计划人数: 12 }
  ]
};

function run(filters = {}) {
  return buildPreviewRows({
    majors,
    years,
    filters: { schoolType: '全部', povertyStatus: '全部', subject: '全部', schoolCount: '', ...filters },
    getScore: (major, year) => scores[major.专业名称][year],
    getPlans: (major) => plans[major.专业名称]
  });
}

test('aggregates every year side by side in one row', () => {
  const row = run().rows[0];
  assert.equal(row.majorName, '软件工程');
  assert.deepEqual(
    years.map((year) => row['score' + year]), [170, 175, 180]);
  assert.deepEqual(
    years.map((year) => row['schoolCount' + year]), [2, 2, 2]);
  assert.deepEqual(
    years.map((year) => row['planCount' + year]), [50, 50, 50]);
  assert.deepEqual(
    years.map((year) => row['povertyPlanCount' + year]), [5, 5, 5]);
});

test('missing yearly scores stay null and are skipped in neither rows nor filters', () => {
  const row = run().rows.find((item) => item.majorName === '会计学');
  assert.equal(row.score2024, null);
  assert.equal(row.score2026, 150);
  assert.deepEqual(run().rows.map((item) => item.majorName), ['软件工程', '会计学', '英语']);
});

test('applies school type and poverty status filters within every year', () => {
  const result = run({ schoolType: '公办', povertyStatus: '是' });
  assert.deepEqual(result.rows.map((row) => row.majorName), ['软件工程', '英语']);
  const se = result.rows[0];
  assert.equal(se.schoolCount2026, 1);
  assert.equal(se.planCount2026, 20);
  assert.equal(se.povertyPlanCount2026, 5);
});

test('全部 values do not force optional filtering', () => {
  assert.deepEqual(run().rows.map((row) => row.majorName), ['软件工程', '会计学', '英语']);
});

test('filters by professional basic course and ignores whitespace differences', () => {
  assert.deepEqual(run({ subject: '管理学' }).rows.map((row) => row.majorName), ['会计学']);
  assert.deepEqual(run({ subject: ' 管理学 ' }).rows.map((row) => row.majorName), ['会计学']);
  assert.deepEqual(run({ subject: '大学语文、专业英语' }).rows.map((row) => row.majorName), ['英语']);
});

test('filters by public course and latest-year score range together', () => {
  assert.deepEqual(run({ publicCourse: '专业英语' }).rows.map((row) => row.majorName), ['英语']);
  assert.deepEqual(run({ scoreMin: '160', scoreMax: '200' }).rows.map((row) => row.majorName), ['软件工程']);
  assert.deepEqual(run({ publicCourse: '公共英语', scoreMin: '140', scoreMax: '160' }).rows.map((row) => row.majorName), ['会计学']);
});

test('ignores invalid score bounds and rejects a reversed valid range', () => {
  assert.equal(run({ scoreMin: '-1x' }).rows.length, 3);
  assert.deepEqual(run({ scoreMin: '200', scoreMax: '180' }).rows, []);
});

test('school count bound keeps majors whose latest-year count is greater than the value', () => {
  assert.deepEqual(run({ schoolCount: '1' }).rows.map((row) => row.majorName), ['软件工程']);
  assert.deepEqual(run({ schoolCount: '2' }).rows.map((row) => row.majorName), []);
  assert.deepEqual(run({ schoolCount: '0' }).rows.map((row) => row.majorName), ['软件工程', '会计学', '英语']);
});

test('counts schools after plan filters before applying the school count bound', () => {
  const result = run({ schoolType: '公办', schoolCount: '1' });
  assert.deepEqual(result.rows.map((row) => row.majorName), []);
  assert.equal(result.effectiveSchoolCount, 0);
});

test('counts a duplicate school once while keeping ordinary and poverty plans separate', () => {
  const row = run({ schoolType: '公办' }).rows[0];
  assert.equal(row.publicSchoolCount2026, 1);
  assert.equal(row.schoolCount2026, 1);
  assert.equal(row.planCount2026, 20);
  assert.equal(row.povertyPlanCount2026, 5);
  assert.equal(run().effectiveSchoolCount, 3);
});

test('poverty filter=是 keeps regular and poverty plans together with merged counts', () => {
  const result = run({ povertyStatus: '是' });
  assert.deepEqual(result.rows.map((row) => row.majorName), ['软件工程', '会计学', '英语']);
  const se = result.rows[0];
  assert.equal(se.schoolCount2026, 2);
  assert.equal(se.planCount2026, 50);
  assert.equal(se.povertyPlanCount2026, 5);
});

test('poverty=否 keeps regular plans and drops the poverty count', () => {
  const result = run({ povertyStatus: '否' });
  assert.deepEqual(result.rows.map((row) => row.majorName), ['软件工程', '英语']);
  const se = result.rows[0];
  assert.equal(se.schoolCount2026, 2);
  assert.equal(se.planCount2026, 50);
  assert.equal(se.povertyPlanCount2026, 0);
});

test('splits school counts and plan totals into public/private as pub/min text', () => {
  assert.deepEqual(
    run().rows.map((row) => row.majorName + ':' + row.schoolSplit2026 + ':' + row.planSplit2026),
    ['软件工程:1/1:20/30', '会计学:0/1:0/0', '英语:1/0:12/0']);
  assert.deepEqual(
    run({ schoolType: '公办' }).rows.map((row) => row.majorName + ':' + row.schoolSplit2026 + ':' + row.planSplit2026),
    ['软件工程:1/0:20/0', '英语:1/0:12/0']);
  assert.deepEqual(
    run({ schoolType: '民办' }).rows.map((row) => row.majorName + ':' + row.schoolSplit2024 + ':' + row.planSplit2024),
    ['软件工程:0/1:0/30', '会计学:0/1:0/0']);
});

test('restores stable original order', () => {
  const rows = run().rows.slice().reverse();
  assert.deepEqual(sortPreviewRows(rows, { key: 'originalOrder', direction: 'original' }).map((row) => row.majorName), [
    '软件工程', '会计学', '英语'
  ]);
});

test('sorts yearly scores in both directions with stable ties', () => {
  const rows = run().rows;
  assert.deepEqual(sortPreviewRows(rows, { key: 'score2026', direction: 'asc' }).map((row) => row.score2026), [150, 180, 210]);
  assert.deepEqual(sortPreviewRows(rows, { key: 'score2026', direction: 'desc' }).map((row) => row.score2026), [210, 180, 150]);
});

test('sorts latest-year school counts in both directions', () => {
  const rows = run().rows;
  assert.deepEqual(sortPreviewRows(rows, { key: 'schoolCount2026', direction: 'asc' }).map((row) => row.schoolCount2026), [1, 1, 2]);
  assert.deepEqual(sortPreviewRows(rows, { key: 'schoolCount2026', direction: 'desc' }).map((row) => row.schoolCount2026), [2, 1, 1]);
});
