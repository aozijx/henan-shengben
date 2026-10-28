import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAnalytics } from '../js/analytics-projection.js';

test('one filtered projection drives every analytics consumer', () => {
  const analytics = { 2027: { majors: [
    { majorCode: '51', majorName: '计算机科学与技术', controlScore: 200, schoolTypes: {
      public: { allSchoolCount: 1, ordinarySchoolCount: 1, ordinaryPlanCount: 30, povertyPlanCount: 2 },
      private: { allSchoolCount: 1, ordinarySchoolCount: 1, ordinaryPlanCount: 50, povertyPlanCount: 0 } } },
    { majorCode: '52', majorName: '软件工程', controlScore: 190, schoolTypes: {
      public: { allSchoolCount: 0, ordinarySchoolCount: 0, ordinaryPlanCount: 0, povertyPlanCount: 0 },
      private: { allSchoolCount: 1, ordinarySchoolCount: 1, ordinaryPlanCount: 20, povertyPlanCount: 0 } } }
  ] } };
  const mapping = [{ '专科专业': '软件技术', '可报本科专业': [
    { '专业代号': '51', '专业名称': '计算机科学与技术', '考试科目': '高等数学' },
    { '专业代号': '52', '专业名称': '软件工程', '考试科目': '高等数学' }
  ] }];
  const view = projectAnalytics(analytics, mapping, [2027], { schoolType: '公办', povertyStatus: '否', subject: '高等数学' });
  assert.deepEqual(view.majors.map((row) => row.majorCode), ['51']);
  assert.equal(view.majors[0].years[2027].planCount, 30);
  assert.equal(view.majors[0].years[2027].schoolCount, 1);
  assert.equal(view.majors[0].years[2027].povertyPlanCount, 0);
});

test('invalid saved numeric filter does not hide every professional row', () => {
  const mapping = [{ '可报本科专业': [{ '专业代号': '51', '专业名称': '软件工程', '考试科目': '高等数学' }] }];
  const annual = { 2027: { majors: [{ majorCode: '51', controlScore: 190,
    schoolTypes: { public: { ordinarySchoolCount: 1, ordinaryPlanCount: 20 } } }] } };
  assert.equal(projectAnalytics(annual, mapping, [2027], { schoolCount: 'undefined', povertyStatus: '否' }).majors.length, 1);
});

test('an active specialty limits analytics to its candidate majors', () => {
  const first = { '专业代号': '51', '专业名称': '软件工程', '考试科目': '高等数学' };
  const second = { '专业代号': '52', '专业名称': '计算机科学与技术', '考试科目': '高等数学' };
  const mapping = [{ '可报本科专业': [first, second] }];
  const schoolTypes = { public: { ordinarySchoolCount: 1, allSchoolCount: 1, ordinaryPlanCount: 20 } };
  const annual = { 2027: { majors: [
    { majorCode: '51', controlScore: 190, schoolTypes },
    { majorCode: '52', controlScore: 180, schoolTypes }
  ] } };
  assert.deepEqual(projectAnalytics(annual, mapping, [2027], {}, [first]).majors.map((row) => row.majorCode), ['51']);
  assert.equal(projectAnalytics(annual, mapping, [2027], {}, []).majors.length, 0);
});

test('two named majors sharing one code keep separate analytics rows', () => {
  const first = { '专业代号': '99', '专业名称': '会计学' };
  const second = { '专业代号': '99', '专业名称': '财务管理' };
  const type = (count) => ({ public: { allSchoolCount: 1, ordinarySchoolCount: 1,
    ordinaryPlanCount: count, povertyPlanCount: 0 } });
  const annual = { 2027: { majors: [
    { majorCode: '99', majorName: '会计学', controlScore: 120, schoolTypes: type(20) },
    { majorCode: '99', majorName: '财务管理', controlScore: 120, schoolTypes: type(30) }
  ] } };
  const view = projectAnalytics(annual, [{ '可报本科专业': [first, second] }], [2027], {}, [first, second]);
  assert.deepEqual(view.majors.map((row) => [row.majorName, row.years[2027].planCount]),
    [['会计学', 20], ['财务管理', 30]]);
});

test('master mark filtering counts only exactly matched schools and never treats blank as no', () => {
  const metadata = { fields: [{ key: 'arts', sourceRole: 'colleges', sourceColumn: '艺术', filterEnable: true }] };
  const major = { '专业代号': '51', '代码6位': '080901', '专业名称': '软件工程' };
  const schoolTypes = { public: { schools: [
    { schoolName: '甲大学', ordinaryPlanCount: 20, povertyPlanCount: 2 },
    { schoolName: '乙大学', ordinaryPlanCount: 30, povertyPlanCount: 0 }
  ] } };
  const annual = { 2027: { majors: [{ majorCode: '51', majorName: '软件工程', schoolTypes }] } };
  const masters = { 2027: [
    { '学校名称': '甲大学', '专业代码': '080901', '艺术': '是', '师范': '' },
    { '学校名称': '乙大学', '专业代码': '080901', '艺术': '', '师范': '' },
    { '学校名称': '乙大学', '专业代码': '999999', '艺术': '是', '师范': '' }
  ] };
  const mapping = [{ '可报本科专业': [major] }];
  const arts = projectAnalytics(annual, mapping, [2027], { arts: '是', povertyStatus: '否' }, null, masters, metadata);
  assert.equal(arts.majors[0].years[2027].schoolCount, 1);
  assert.equal(arts.majors[0].years[2027].planCount, 20);
  const blank = projectAnalytics(annual, mapping, [2027], { arts: '未标注' }, null, masters, metadata);
  assert.equal(blank.majors[0].years[2027].planCount, 30);
});
