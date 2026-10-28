import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaginationHtml, formatFieldValue, nextSortDirection, paginate } from '../js/table-utils.js';

test('paginates partial and empty result sets without invalid ranges', () => {
  const rows = ['甲', '乙', '丙'];
  assert.deepEqual(paginate(rows, 2, 2), {
    rows: ['丙'], page: 2, pageCount: 2, total: 3, start: 3, end: 3
  });
  assert.deepEqual(paginate([], 9, 2), {
    rows: [], page: 1, pageCount: 1, total: 0, start: 0, end: 0
  });
});

test('pagination controls and sort direction match the current table state', () => {
  const html = buildPaginationHtml(2, 2, '专业分页');
  assert.match(html, /class="table-pagination" aria-label="专业分页"/);
  assert.match(html, /data-page="3" disabled/);
  assert.equal(nextSortDirection({ key: 'score', direction: 'desc' }, 'score'), 'asc');
  assert.equal(nextSortDirection({ key: 'score', direction: 'asc' }, 'score'), 'desc');
});

test('formats missing, numeric and boolean export fields', () => {
  assert.equal(formatFieldValue({ score: null }, { key: 'score', type: 'number' }), '—');
  assert.equal(formatFieldValue({ score: 180 }, { key: 'score', type: 'number' }), '180');
  assert.equal(formatFieldValue({ selected: true }, { key: 'selected', type: 'boolean' }), '是');
});
