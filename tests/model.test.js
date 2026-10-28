import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMajorOption, normalizePlanEntry, normalizeScoreSegmentSeries } from '../js/model.js';

test('normalizes whitespace full-width parentheses and discipline suffixes', () => {
  const major = normalizeMajorOption({
    专业名称: ' 软件工程（本科层次职业教育专业） ', 专业代号: ' 52 ', 代码6位: '080902T',
    考试科目代码: '04', 考试科目: '高等数学'
  }, { defaultLabel: '公共英语', professionalEnglishPattern: '专业英语' });
  assert.equal(major.majorName, '软件工程(本科层次职业教育专业)');
  assert.equal(major.disciplineCode6, '080902T');
  assert.equal(major.publicCourse, '公共英语');
  assert.deepEqual(major.professionalCourse, { code: '04', name: '高等数学' });
});

test('normalizes plan entries and preserves missing values as null', () => {
  const plan = normalizePlanEntry({ 年度: 2027, 专业代号: '52', 专业名称: '软件工程', 院校名称: ' 测试大学 ', 办学性质: '公办' });
  assert.equal(plan.schoolName, '测试大学');
  assert.equal(plan.planCount, null);
  assert.equal(plan.tuition, null);
});

test('plan normalization does not infer art or teacher status from a major name', () => {
  const plan = normalizePlanEntry({ 专业名称: '美术学(师范)', 院校名称: '甲大学' });
  assert.equal(Object.hasOwn(plan, 'arts'), false);
  assert.equal(Object.hasOwn(plan, 'teacherTraining'), false);
});

test('normalizes score segment series without inventing missing values', () => {
  const series = normalizeScoreSegmentSeries({ year: 2027, majorCode: '52', majorName: '软件工程', sourceId: 'official', segments: [{ score: 200, cumulativeCount: 1 }] });
  assert.deepEqual(series.segments, [{ score: 200, cumulativeCount: 1 }]);
  assert.equal(series.controlScore, null);
});
