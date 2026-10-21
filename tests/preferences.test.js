import test from 'node:test';
import assert from 'node:assert/strict';
import { COLUMN_WIDTHS_KEY, clearPreferences, readColumnWidths, writeColumnWidths } from '../js/preferences.js';

const metadata = {
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
