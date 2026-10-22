import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatsYearContext } from '../js/stats.js';

test('statistics use the maximum configured year regardless of input order', () => {
  assert.deepEqual(buildStatsYearContext([2026, 2028, 2027]), {
    years: [2026, 2027, 2028], latestYear: 2028
  });
});
