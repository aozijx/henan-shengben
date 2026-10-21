import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreviewHtml, formatFieldValue, getPreviewFields, paginate, resizeColumnWidth } from '../js/preview.js';

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
  const html = buildPreviewHtml({ rows, page: 2, effectiveSchoolCount: 17, hasSearch: true }, metadata);
  assert.match(html, /有效院校 17 所/);
  assert.match(html, /英语/);
  assert.match(html, /工商管理/);
  assert.doesNotMatch(html, /软件工程/);
  assert.doesNotMatch(html, /护理学/);
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
