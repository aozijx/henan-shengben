import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreviewHtml, formatFieldValue, getPreviewFields, nextSortDirection, paginate, resizeColumnWidth } from '../js/preview.js';

const metadata = {
  pageSize: 2,
  fields: [
    { key: 'score', label: '分数线', type: 'number', tableShow: true },
    { key: 'hidden', label: '隐藏列', type: 'string', tableShow: false },
    { key: 'majorName', label: '本科专业', type: 'string', tableShow: true }
  ]
};

const rows = [
  { majorName: '软件工程', score: 180 },
  { majorName: '会计学', score: 150 },
  { majorName: '英语', score: null },
  { majorName: '工商管理', score: 200 },
  { majorName: '护理学', score: 190 }
];

test('uses metadata table column order and excludes hidden fields', () => {
  assert.deepEqual(getPreviewFields(metadata).map((field) => field.key), ['score', 'majorName']);
  const html = buildPreviewHtml({ rows: rows.slice(0, 1), page: 1, effectiveSchoolCount: 2, hasSearch: true }, metadata);
  assert.ok(html.indexOf('分数线') < html.indexOf('本科专业'));
  assert.doesNotMatch(html, /隐藏列/);
});

test('paginates first and last partial pages', () => {
  assert.deepEqual(paginate(rows, 1, 2), {
    rows: rows.slice(0, 2), page: 1, pageCount: 3, total: 5, start: 1, end: 2
  });
  assert.deepEqual(paginate(rows, 3, 2), {
    rows: rows.slice(4), page: 3, pageCount: 3, total: 5, start: 5, end: 5
  });
});

test('clamps pages after a result set shrinks', () => {
  const result = paginate(rows.slice(0, 1), 4, 2);
  assert.equal(result.page, 1);
  assert.deepEqual(result.rows, rows.slice(0, 1));
});

test('returns an empty page model without negative ranges', () => {
  assert.deepEqual(paginate([], 8, 2), { rows: [], page: 1, pageCount: 1, total: 0, start: 0, end: 0 });
});

test('renders filtered empty separately from the initial state', () => {
  assert.match(buildPreviewHtml({ rows: [], page: 1, effectiveSchoolCount: 0, hasSearch: false }, metadata), /请先查询/);
  assert.match(buildPreviewHtml({ rows: [], page: 1, effectiveSchoolCount: 0, hasSearch: true }, metadata), /没有匹配数据/);
});

test('renders effective school statistics and only the current page rows', () => {
  const html = buildPreviewHtml({ rows, page: 2, effectiveSchoolCount: 17, effectiveSchoolYear: 2026, hasSearch: true }, metadata);
  assert.match(html, /有效院校（2026） 17 所/);
  assert.match(html, /英语/);
  assert.match(html, /工商管理/);
  assert.doesNotMatch(html, /软件工程/);
  assert.doesNotMatch(html, /护理学/);
});

test('marks only sortable headers and shows the current sort indicator', () => {
  const sortableMetadata = {
    pageSize: 2,
    fields: [
      { key: 'score', label: '分数线', type: 'number', tableShow: true, sortEnable: true },
      { key: 'majorName', label: '本科专业', type: 'string', tableShow: true, sortEnable: false },
      { key: 'schoolSplit', label: '院校数(公/民)', type: 'string', tableShow: true, sortEnable: false, sortKey: 'schoolCount' }
    ]
  };
  const unsorted = buildPreviewHtml({ rows: rows.slice(0, 1), page: 1, hasSearch: true, sort: { key: 'originalOrder', direction: 'original' } }, sortableMetadata);
  assert.match(unsorted, /<th scope="col" data-field="score" class="sortable" data-sort="score" title="点击排序">/);
  assert.match(unsorted, /<th scope="col" data-field="majorName">/);
  assert.match(unsorted, /<th scope="col" data-field="schoolSplit" class="sortable" data-sort="schoolCount"/);
  assert.doesNotMatch(unsorted, /sort-ind/);

  const desc = buildPreviewHtml({ rows: rows.slice(0, 1), page: 1, hasSearch: true, sort: { key: 'schoolCount', direction: 'desc' } }, sortableMetadata);
  assert.match(desc, /data-field="schoolSplit" class="sortable" data-sort="schoolCount" title="点击排序" aria-sort="descending"/);
  assert.match(desc, /▼/);
  const asc = buildPreviewHtml({ rows: rows.slice(0, 1), page: 1, hasSearch: true, sort: { key: 'score', direction: 'asc' } }, sortableMetadata);
  assert.match(asc, /aria-sort="ascending"/);
  assert.match(asc, /▲/);
});

test('header clicks cycle from high to low then low to high', () => {
  assert.equal(nextSortDirection(null, 'score'), 'desc');
  assert.equal(nextSortDirection({ key: 'majorName', direction: 'asc' }, 'score'), 'desc');
  assert.equal(nextSortDirection({ key: 'score', direction: 'desc' }, 'score'), 'asc');
  assert.equal(nextSortDirection({ key: 'score', direction: 'asc' }, 'score'), 'desc');
});

test('formats null and numeric values consistently for preview and export', () => {
  assert.equal(formatFieldValue({ score: null }, metadata.fields[0]), '—');
  assert.equal(formatFieldValue({ score: 180 }, metadata.fields[0]), '180');
});

test('column resizing is keyboard-friendly and clamped to safe bounds', () => {
  assert.equal(resizeColumnWidth(180, -10), 170);
  assert.equal(resizeColumnWidth(80, -10), 80);
  assert.equal(resizeColumnWidth(600, 10), 600);
});
