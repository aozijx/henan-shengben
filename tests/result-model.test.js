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
