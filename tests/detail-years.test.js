import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCollegeYear } from '../js/detail-years.js';

test('college detail defaults to the latest available year regardless of list order', () => {
  assert.equal(defaultCollegeYear([2026, 2023, 2027]), '2027');
  assert.equal(defaultCollegeYear([]), 'all');
});
