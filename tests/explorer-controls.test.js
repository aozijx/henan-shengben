import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExplorerControlsHtml } from '../js/explorer.js';

test('year selection remains in filters when no matching major is shown', () => {
  const metadata = { supportedYears: [2024, 2025, 2026], fields: [] };
  const state = {
    status: 'ready', majors: [], filters: {}, selectedYears: [2024, 2026],
    rows: [], focusYear: 2026
  };
  const html = buildExplorerControlsHtml(metadata, state);

  assert.match(html, /filter-panel[\s\S]*data-filter-action="years"/);
  assert.match(html, /aria-label="选择展示年份，当前已选 2024、2026">2024、2026<\/button>/);
  assert.match(html, /class="year-selection-dialog"/);
  assert.match(html, /当前基准：2026 年/);
});

test('three selected years remain explicit', () => {
  const metadata = { supportedYears: [2024, 2025, 2026], fields: [] };
  const state = {
    status: 'ready', majors: [], filters: {}, selectedYears: [2024, 2025, 2026],
    rows: [], focusYear: 2026
  };
  const html = buildExplorerControlsHtml(metadata, state);
  const yearButton = html.match(/<button type="button" data-filter-action="years"[^>]*>([^<]*)<\/button>/);

  assert.equal(yearButton && yearButton[1], '2024、2025、2026');
  assert.doesNotMatch(yearButton && yearButton[0] || '', /全部/);
});

test('more than three selected years use a compact label but keep the full accessible list', () => {
  const metadata = { supportedYears: [2023, 2024, 2025, 2026],
    sourceCatalog: { mapping: { 2027: 'data/mapping-2027.json' } }, fields: [] };
  const state = { status: 'ready', majors: [], filters: {}, selectedYears: [2023, 2024, 2026, 2027],
    rows: [], focusYear: 2027 };
  const html = buildExplorerControlsHtml(metadata, state);
  assert.match(html, />2023–2027<\/button>/);
  assert.match(html, /aria-label="选择展示年份，当前已选 2023、2024、2026、2027"/);
  assert.match(html, /value="2027" checked/);
});
