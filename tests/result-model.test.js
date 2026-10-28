import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResultModel } from '../js/result-model.js';

test('建档立卡筛选为否时，聚合详情只保留普通计划明细', () => {
  const aggregate = {
    major: { majorName: '软件工程' },
    years: {
      2026: {
        score: 180,
        publicSummary: { schoolCount: 1, ordinaryPlanCount: 20, povertyPlanCount: 3 },
        privateSummary: { schoolCount: 0, ordinaryPlanCount: 0, povertyPlanCount: 0 },
        schools: [{
          schoolId: '河南大学', schoolName: '河南大学', schoolType: '公办',
          ordinaryPlanCount: 20, povertyPlanCount: 3,
          planEntries: [
            { admissionCategory: '普通专升本', povertyStatus: '否', planCount: 20 },
            { admissionCategory: '建档立卡专项', povertyStatus: '是', planCount: 3 }
          ]
        }]
      }
    }
  };

  const result = buildResultModel({
    aggregates: [aggregate], metadata: { supportedYears: [2026] }, selectedYears: [2026],
    filters: { povertyStatus: '否' }
  });
  const school = result.aggregates[0].years[2026].schools[0];

  assert.equal(school.povertyPlanCount, 0);
  assert.equal(school.planEntries.length, 1);
  assert.equal(school.planEntries[0].admissionCategory, '普通专升本');
  assert.equal(result.allRows[0].povertyPlanCount2026, 0);
});

test('a mapping-only major remains searchable while a poverty-only annual major stays hidden', () => {
  const metadata = { supportedYears: [2026] };
  const empty = { major: { majorName: '新专业' }, years: {
    2026: { score: null, schools: [], publicSummary: { schoolCount: 0 }, privateSummary: { schoolCount: 0 } }
  } };
  const poverty = { major: { majorName: '仅专项' }, years: {
    2026: { score: 180, schools: [{ schoolName: '甲', schoolType: '公办', ordinaryPlanCount: 0,
      povertyPlanCount: 2, planEntries: [{ povertyStatus: '是', planCount: 2 }] }],
    publicSummary: { schoolCount: 1 }, privateSummary: { schoolCount: 0 } }
  } };
  const result = buildResultModel({ aggregates: [empty, poverty], metadata, selectedYears: [2026],
    filters: { schoolType: '全部', povertyStatus: '否' } });
  assert.deepEqual(result.aggregates.map(item => item.major.majorName), ['新专业']);
});

test('master mark filters keep only schools with explicit source-table evidence', () => {
  const metadata = { supportedYears: [2027], fields: [
    { key: 'teacherTraining', sourceRole: 'colleges', sourceColumn: '师范', filterEnable: true },
    { key: 'arts', sourceRole: 'colleges', sourceColumn: '艺术', filterEnable: true }
  ] };
  const aggregate = { major: { majorName: '美术学' }, years: { 2027: {
    score: null, planPublished: false,
    schools: [
      { schoolName: '甲大学', schoolType: '未标注', fallbackOnly: true,
        masterEntries: [{ 师范: '是', 艺术: '是' }], planEntries: [] },
      { schoolName: '乙大学', schoolType: '未标注', fallbackOnly: true,
        masterEntries: [{ 师范: '', 艺术: '' }], planEntries: [] }
    ],
    publicSummary: { schoolCount: 0 }, privateSummary: { schoolCount: 0 }
  } } };
  const result = buildResultModel({ aggregates: [aggregate], metadata,
    selectedYears: [2027], filters: { arts: '是', povertyStatus: '否' } });
  assert.deepEqual(result.aggregates[0].years[2027].schools.map((school) => school.schoolName), ['甲大学']);
  const blank = buildResultModel({ aggregates: [aggregate], metadata,
    selectedYears: [2027], filters: { teacherTraining: '未标注' } });
  assert.deepEqual(blank.aggregates[0].years[2027].schools.map((school) => school.schoolName), ['乙大学']);
});

test('a published master-only school is not reported as a zero-person plan', () => {
  const aggregate = { major: { majorName: '美术学' }, years: { 2026: {
    planPublished: true, score: null, schools: [{ schoolName: '甲大学', schoolType: '未标注',
      fallbackOnly: true, ordinaryPlanCount: 0, povertyPlanCount: 0, planEntries: [] }],
    publicSummary: { schoolCount: 0 }, privateSummary: { schoolCount: 0 }
  } } };
  const result = buildResultModel({ aggregates: [aggregate], metadata: { supportedYears: [2026] },
    selectedYears: [2026], filters: {} });
  assert.equal(result.allRows[0].planCount2026, null);
  assert.equal(result.allRows[0].planSplit2026, '未单列');
});
