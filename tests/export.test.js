import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExportFilename, downloadCsv, getExportFields, prepareExport, serializeCsv } from '../js/export.js';

const fields = [
  { key: 'majorName', label: '专业', exportLabel: '本科专业', type: 'string', exportEnable: true },
  { key: 'score', label: '分数', exportLabel: '控制线', type: 'number', exportEnable: true },
  { key: 'hidden', label: '隐藏', exportLabel: '隐藏', type: 'string', exportEnable: false }
];

test('uses metadata export order and preserves preview row order', () => {
  const csv = serializeCsv([
    { majorName: '软件工程', score: 180 },
    { majorName: '会计学', score: 150 }
  ], getExportFields({ fields }));
  assert.equal(csv, '\uFEFF本科专业,控制线\r\n软件工程,180\r\n会计学,150');
  assert.doesNotMatch(csv, /隐藏/);
});

test('quotes commas, quotes and newlines according to CSV rules', () => {
  const csv = serializeCsv([{ majorName: '名称,"甲"\n第二行', score: null }], getExportFields({ fields }));
  assert.equal(csv, '\uFEFF本科专业,控制线\r\n"名称,""甲""\n第二行",—');
});

test('prefixes UTF-8 BOM and formats null through the preview formatter', () => {
  const csv = serializeCsv([{ majorName: null, score: null }], getExportFields({ fields }));
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.match(csv, /—,—$/);
});

test('builds the required year and local date filename', () => {
  assert.equal(buildExportFilename(2027, new Date(2026, 9, 21, 15, 30)), '院校数据_2027_20261021.csv');
});

test('download rejects empty preview results', () => {
  assert.throws(() => downloadCsv({ rows: [], fields, year: 2026, date: new Date() }, {}, {}), /没有可导出的预览数据/);
});

test('download creates and revokes one CSV object URL', () => {
  const events = [];
  const anchor = {
    style: {},
    click() { events.push(['click', this.download]); },
    remove() { events.push(['remove']); }
  };
  const documentLike = {
    createElement(name) { assert.equal(name, 'a'); return anchor; },
    body: { appendChild(node) { assert.equal(node, anchor); events.push(['append']); } }
  };
  const urlApi = {
    createObjectURL(blob) { assert.equal(blob.type, 'text/csv;charset=utf-8'); events.push(['create']); return 'blob:test'; },
    revokeObjectURL(url) { events.push(['revoke', url]); }
  };

  const filename = downloadCsv({
    rows: [{ majorName: '软件工程', score: 180 }], fields: getExportFields({ fields }), year: 2026,
    date: new Date(2026, 9, 21)
  }, documentLike, urlApi);

  assert.equal(filename, '院校数据_2026_20261021.csv');
  assert.equal(anchor.href, 'blob:test');
  assert.deepEqual(events, [
    ['create'], ['append'], ['click', '院校数据_2026_20261021.csv'], ['remove'], ['revoke', 'blob:test']
  ]);
});

test('prepareExport uses the complete preview result instead of the current page', () => {
  const previewModel = {
    status: 'ready',
    allRows: [{ majorName: '一', score: 1 }, { majorName: '二', score: 2 }, { majorName: '三', score: 3 }],
    pageRows: [{ majorName: '三', score: 3 }]
  };
  const prepared = prepareExport(previewModel, { fields }, 2027);
  assert.equal(prepared.rows.length, 3);
  assert.deepEqual(prepared.fields.map((field) => field.key), ['majorName', 'score']);
  assert.equal(prepared.year, 2027);
});

test('prepareExport rejects unavailable or empty preview data', () => {
  assert.throws(() => prepareExport({ status: 'error', allRows: [] }, { fields }, 2027), /不可导出/);
  assert.throws(() => prepareExport({ status: 'ready', allRows: [] }, { fields }, 2027), /没有可导出/);
});
