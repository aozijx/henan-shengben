import test from 'node:test';
import assert from 'node:assert/strict';
import { queryRowsFromAnalytics, queryRowsFromPublishedSources } from '../js/analytics-query.js';
import { buildPreviewRows } from '../js/pipeline.js';
import { selectMajorRows } from '../js/major-match.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function read(relative) { return JSON.parse(readFileSync(join(root, relative), 'utf8')); }

test('published analytics retains exact college master fields for filters and details', () => {
  const master = { '学校名称': '甲大学', '专业代码': '080901', '专业名称': '软件工程', '师范': '', '艺术': '是' };
  const result = queryRowsFromPublishedSources({ 2027: { majors: [] } }, { 2027: { colleges: [master] } }, [2027]);
  assert.equal(result.fallbacksByYear[2027].length, 1);
  assert.equal(result.fallbacksByYear[2027][0]['艺术'], '是');
});

test('annual summaries drive preview totals and deduplicated school count', () => {
  const major = { '专业代号': '51', '专业名称': '软件工程', '考试科目': '高等数学' };
  const annual = { 2027: { majors: [{ majorCode: '51', majorName: '软件工程', controlScore: 190,
    schoolTypes: { public: { schools: [
      { schoolName: '甲大学', ordinaryPlanCount: 30, povertyPlanCount: 2, hasOrdinaryPlan: true, hasPovertyPlan: true },
      { schoolName: '乙大学', ordinaryPlanCount: 0, povertyPlanCount: 3, hasOrdinaryPlan: false, hasPovertyPlan: true }
    ] }, private: { schools: [] } } }] } };
  const rows = queryRowsFromAnalytics(annual, [2027]);
  const preview = (filters) => buildPreviewRows({ majors: [major], years: [2027], filters,
    getScore: (_major, year) => rows.scoresByYear[year][0]['分数线'],
    getPlans: (_major, year) => rows.plansByYear[year] });
  const all = preview({ povertyStatus: '全部' });
  assert.equal(all.rows[0].planCount2027, 30);
  assert.equal(all.rows[0].povertyPlanCount2027, 5);
  assert.equal(all.effectiveSchoolCount, 2);
  const ordinary = preview({ povertyStatus: '否' });
  assert.equal(ordinary.rows[0].povertyPlanCount2027, 0);
  assert.equal(ordinary.effectiveSchoolCount, 1);
});

test('same-name admission codes count separately until a poverty-only code is filtered', () => {
  const major = { '专业代号': '04', '专业名称': '金融学', '考试科目': '经济学' };
  const annual = { 2027: { majors: [{ majorCode: '04', majorName: '金融学', controlScore: 180,
    schoolTypes: { public: { schools: [
      { schoolName: '甲大学', schoolCode: '6081', ordinaryPlanCount: 29, povertyPlanCount: 0,
        hasOrdinaryPlan: true, hasPovertyPlan: false },
      { schoolName: '甲大学', schoolCode: '6469', ordinaryPlanCount: 0, povertyPlanCount: 1,
        hasOrdinaryPlan: false, hasPovertyPlan: true }
    ] }, private: { schools: [] } } }] } };
  const summary = queryRowsFromAnalytics(annual, [2027]);
  const preview = (povertyStatus) => buildPreviewRows({ majors: [major], years: [2027],
    filters: { povertyStatus }, getScore: () => 180, getPlans: () => summary.plansByYear[2027] });
  assert.equal(preview('全部').rows[0].schoolCount2027, 2);
  assert.equal(preview('全部').effectiveSchoolCount, 2);
  assert.equal(preview('否').rows[0].schoolCount2027, 1);
  assert.equal(preview('否').effectiveSchoolCount, 1);
});

test('published analytics reproduces the 2026 query preview without full plan downloads', () => {
  const metadata = read('metadata/school-data.json');
  const mapping = read(metadata.yearSources[2026].mappingSource);
  const plans = read(metadata.yearSources[2026].planSource);
  const scores = read(metadata.yearSources[2026].scoreSource);
  const analytics = read(metadata.yearSources[2026].analyticsSource);
  const majors = mapping.find((entry) => entry['专科专业'] === '物联网应用技术')['可报本科专业'];
  const summary = queryRowsFromAnalytics({ 2026: analytics }, [2026]);
  const run = (planRows, scoreRows) => buildPreviewRows({ majors, years: [2026], filters: { povertyStatus: '否' },
    getScore: (major) => scoreRows.find((row) => row['专业代号'] === major['专业代号'])?.['分数线'] ?? null,
    getPlans: (major) => selectMajorRows(planRows, major['专业代号'], major['专业名称'],
      row => row['专业代号'], row => row['专业名称'])
  });
  const expected = run(plans, scores);
  const actual = run(summary.plansByYear[2026], summary.scoresByYear[2026]);
  assert.equal(actual.effectiveSchoolCount, expected.effectiveSchoolCount);
  assert.deepEqual(actual.rows, expected.rows);
});
