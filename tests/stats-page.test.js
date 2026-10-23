import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatsTableHtml } from '../js/stats-page.js';

test('complete major table uses the same previous and next footer as search preview', () => {
  const projection = {
    years: [2026],
    majors: ['软件工程', '计算机科学与技术', '物联网工程'].map((majorName, index) => ({
      majorName, majorCode: String(index + 1),
      years: { 2026: { score: 100 + index, schoolCount: 1, planCount: 20,
        ordinaryPlanCount: 18, povertyPlanCount: 2,
        schoolTypes: { public: { schoolCount: 1 }, private: { schoolCount: 0 } } } }
    }))
  };
  const html = buildStatsTableHtml(projection, { pageSize: 2 }, 2);

  assert.match(html, /class="preview-pagination"/);
  assert.match(html, /data-page="1"[^>]*>上一页/);
  assert.match(html, /data-page="3"[^>]*disabled>下一页/);
  assert.match(html, /第 2 \/ 2 页/);
  assert.match(html, /物联网工程/);
  assert.match(html, /院校 公 1 \/ 民 0/);
  assert.match(html, /普通 18 \/ 专项 2 人/);
  assert.doesNotMatch(html, /软件工程/);
});
