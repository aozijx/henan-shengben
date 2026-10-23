import test from 'node:test';
import assert from 'node:assert/strict';
import { COLUMN_WIDTHS_KEY, clearPreferences, clearUiPreferences, readColumnWidths, readExplorerState, writeColumnWidths, writeExplorerState } from '../js/preferences.js';

const metadata = {
  supportedYears: [2024, 2025, 2026],
  uiDefaults: { selectedYears: 'allSupportedYears', resultLayout: 'cards' },
  defaultSort: { key: 'originalOrder', direction: 'original' },
  fields: [
    { key: 'majorName', type: 'string', tableShow: true },
    { key: 'score', type: 'number', tableShow: true },
    { key: 'hidden', type: 'string', tableShow: false }
  ]
};

function storage(initial = {}) {
  const values = { ...initial };
  const calls = [];
  return {
    calls,
    getItem(key) { return key in values ? values[key] : null; },
    setItem(key, value) { calls.push(['setItem', key, value]); values[key] = value; },
    clear() { calls.push(['clear']); Object.keys(values).forEach((key) => delete values[key]); }
  };
}

test('writes only the table width preference key', () => {
  const target = storage();
  writeColumnWidths(target, { majorName: 220, score: 120 });
  assert.equal(target.calls.length, 1);
  assert.equal(target.calls[0][0], 'setItem');
  assert.equal(target.calls[0][1], COLUMN_WIDTHS_KEY);
  assert.deepEqual(JSON.parse(target.calls[0][2]), { majorName: 220, score: 120 });
});

test('malformed storage falls back to safe metadata defaults', () => {
  const target = storage({ [COLUMN_WIDTHS_KEY]: '{broken' });
  assert.deepEqual(readColumnWidths(target, metadata), { majorName: 180, score: 120 });
});

test('unknown, hidden and invalid widths are discarded', () => {
  const target = storage({
    [COLUMN_WIDTHS_KEY]: JSON.stringify({ majorName: 240, score: 20, hidden: 300, unknown: 400 })
  });
  assert.deepEqual(readColumnWidths(target, metadata), { majorName: 240, score: 120 });
});

test('clear preferences invokes full storage clear', () => {
  const target = storage({ theme: 'dark', [COLUMN_WIDTHS_KEY]: '{}' });
  clearPreferences(target);
  assert.deepEqual(target.calls, [['clear']]);
});

test('clearing UI preferences restores defaults without clearing repository memory', () => {
  const target = storage({ theme: 'dark' });
  let repositoryClears = 0;
  const reset = clearUiPreferences(target, {
    ...metadata,
    defaultSort: { key: 'originalOrder', direction: 'original' }
  }, { clear() { repositoryClears += 1; } });
  assert.equal(repositoryClears, 0);
  assert.deepEqual(reset.sort, { key: 'originalOrder', direction: 'original' });
  assert.equal(reset.page, 1);
  assert.deepEqual(target.calls, [['clear']]);
});

test('persists only valid selected years and result layout as explorer UI state', () => {
  const target = storage();
  writeExplorerState(target, {
    filters: {}, sort: metadata.defaultSort, selectedYears: [2026, 2024, 2030], resultLayout: 'table'
  });
  assert.deepEqual(readExplorerState(target, metadata).selectedYears, [2024, 2026]);
  assert.equal(readExplorerState(target, metadata).resultLayout, 'table');

  target.setItem('henan-explorer-v1', JSON.stringify({ selectedYears: [], resultLayout: 'bad' }));
  const fallback = readExplorerState(target, metadata);
  assert.deepEqual(fallback.selectedYears, [2024, 2025, 2026]);
  assert.equal(fallback.resultLayout, 'cards');
});
