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
  assert.match(html, /年份：2024、2026/);
  assert.match(html, /class="year-selection-dialog"/);
  assert.match(html, /当前基准：2026 年/);
});
