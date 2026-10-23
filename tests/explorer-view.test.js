import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExplorerControlsHtml } from '../js/explorer.js';

test('keeps reset and local-storage cleanup beside the filter controls', () => {
  const metadata = {
    fields: [
      { key: 'schoolType', label: '办学性质', type: 'enum', enumValues: ['公办'], filterEnable: true },
      { key: 'povertyStatus', label: '建档立卡', type: 'enum', enumValues: ['是', '否'], filterEnable: true }
    ]
  };
  const state = { status: 'ready', majors: [{ 专业名称: '软件工程' }], filters: { schoolType: '全部', povertyStatus: '否' }, rows: [] };
  const html = buildExplorerControlsHtml(metadata, state);

  assert.match(html, /class="filter-group filter-operations"/);
  assert.match(html, /data-action="reset"/);
  assert.match(html, /data-action="clear-storage"/);
  assert.doesNotMatch(html, /class="explorer-actions"/);
});
