import test from 'node:test';
import assert from 'node:assert/strict';
import * as render from '../js/render.js';
import { buildResultWorkspaceHtml } from '../js/results-view.js';

test('places public and private plan totals after their matching school counts', () => {
  const rows = [
    { 院校名称: '公办大学', 办学性质: '公办', 建档立卡: '否', 计划人数: 20 },
    { 院校名称: '公办大学', 办学性质: '公办', 建档立卡: '是', 计划人数: 5 },
    { 院校名称: '民办学院', 办学性质: '民办', 建档立卡: '否', 计划人数: 30 }
  ];

  const html = render.buildYearSummaryHtml?.(rows);

  assert.equal(html,
    '<span class="yg-pub">公办 1 所 · 计划 25 人</span>' +
    '<span class="yg-min">民办 1 所 · 计划 30 人</span>');
});

test('derives result-table years from metadata instead of a fixed three-year list', () => {
  assert.deepEqual(render.buildYearContext({ supportedYears: [2027, 2025, 2026], defaultYear: 2025 }), {
    years: [2025, 2026, 2027],
    latestYear: 2027,
    previousYear: 2026
  });
});

test('table result markup has a horizontally scrollable container for narrow screens', () => {
  const html = buildResultWorkspaceHtml({
    status: 'ready', hasQuery: true, resultLayout: 'table', selectedYears: [2026],
    aggregates: [{ major: { majorName: '软件工程', majorCode: '80', publicCourse: '公共英语', professionalCourse: { name: '高等数学' } }, years: {
      2026: { score: 180, publicSummary: { schoolCount: 1, ordinaryPlanCount: 20, povertyPlanCount: 3 }, privateSummary: { schoolCount: 0, ordinaryPlanCount: 0, povertyPlanCount: 0 }, schools: [] }
    } }]
  }, { supportedYears: [2026] });
  assert.match(html, /aggregate-table-wrap/);
  assert.match(html, /aggregate-table/);
});
