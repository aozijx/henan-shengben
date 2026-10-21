import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreviewRows, sortPreviewRows, validateScoreRange } from '../js/pipeline.js';

const metadata = {
  fields: [{ key: 'score', type: 'number', min: 0, max: 750 }]
};

const majors = [
  { 专业名称: '软件工程', 专业代号: '80' },
  { 专业名称: '会计学', 专业代号: '97' },
  { 专业名称: '英语', 专业代号: 'C1' }
];

const scores = { 软件工程: 180, 会计学: 150, 英语: 210 };
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
    year: 2026,
    filters: { schoolType: '全部', povertyStatus: '全部', minScore: '', maxScore: '', ...filters },
    getScore: (major) => scores[major.专业名称],
    getPlans: (major) => plans[major.专业名称]
  });
}

test('applies school type, poverty status and score filters with AND semantics', () => {
  const result = run({ schoolType: '公办', povertyStatus: '是', minScore: '180', maxScore: '180' });
  assert.deepEqual(result.rows.map((row) => row.majorName), ['软件工程']);
  assert.equal(result.rows[0].schoolCount, 1);
  assert.equal(result.rows[0].planCount, 5);
});

test('全部 values do not force school type or poverty filtering', () => {
  assert.deepEqual(run().rows.map((row) => row.majorName), ['软件工程', '会计学', '英语']);
});

test('supports public/private and yes/no filter branches', () => {
  assert.deepEqual(run({ schoolType: '民办' }).rows.map((row) => row.majorName), ['软件工程', '会计学']);
  assert.deepEqual(run({ povertyStatus: '否' }).rows.map((row) => row.majorName), ['软件工程', '英语']);
});

test('score bounds are inclusive and accept preset range values', () => {
  assert.deepEqual(run({ minScore: '150', maxScore: '180' }).rows.map((row) => row.majorName), ['软件工程', '会计学']);
});

test('rejects letters, special characters, negatives and reversed score bounds', () => {
  assert.equal(validateScoreRange({ minScore: '1a', maxScore: '' }, metadata).valid, false);
  assert.equal(validateScoreRange({ minScore: '1.5', maxScore: '' }, metadata).valid, false);
  assert.equal(validateScoreRange({ minScore: '-1', maxScore: '' }, metadata).valid, false);
  assert.match(validateScoreRange({ minScore: '200', maxScore: '100' }, metadata).error, /最低分.*最高分/);
});

test('accepts blank bounds and returns normalized numeric values', () => {
  assert.deepEqual(validateScoreRange({ minScore: '', maxScore: '200' }, metadata), {
    valid: true, error: '', min: null, max: 200
  });
});

test('counts a duplicate school once while summing ordinary and poverty plans', () => {
  const row = run({ schoolType: '公办' }).rows[0];
  assert.equal(row.publicSchoolCount, 1);
  assert.equal(row.schoolCount, 1);
  assert.equal(row.planCount, 25);
  assert.equal(run().effectiveSchoolCount, 3);
});

test('restores stable original order', () => {
  const rows = run().rows.slice().reverse();
  assert.deepEqual(sortPreviewRows(rows, { key: 'originalOrder', direction: 'original' }).map((row) => row.majorName), [
    '软件工程', '会计学', '英语'
  ]);
});

test('sorts scores in both directions with stable ties', () => {
  const rows = run().rows;
  assert.deepEqual(sortPreviewRows(rows, { key: 'score', direction: 'asc' }).map((row) => row.score), [150, 180, 210]);
  assert.deepEqual(sortPreviewRows(rows, { key: 'score', direction: 'desc' }).map((row) => row.score), [210, 180, 150]);
});

test('sorts school counts in both directions', () => {
  const rows = run().rows;
  assert.deepEqual(sortPreviewRows(rows, { key: 'schoolCount', direction: 'asc' }).map((row) => row.schoolCount), [1, 1, 2]);
  assert.deepEqual(sortPreviewRows(rows, { key: 'schoolCount', direction: 'desc' }).map((row) => row.schoolCount), [2, 1, 1]);
});
