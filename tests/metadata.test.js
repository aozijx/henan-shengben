import test from 'node:test';
import assert from 'node:assert/strict';
import { expandMetadata, getLatestYear, getPreviousYear, getSortedYears, loadMetadata, validateMetadata } from '../js/metadata.js';

function validMetadata() {
  return {
    schemaVersion: 1,
    defaultYear: 2026,
    supportedYears: [2026],
    yearSources: {
      2026: {
        mappingSource: 'data/mapping.json',
        scoreSource: 'data/scores.json',
        planSource: 'data/plans.json'
      }
    },
    fields: [
      {
        key: 'majorName', label: '本科专业', exportLabel: '本科专业', type: 'string',
        filterEnable: false, sortEnable: false, tableShow: true, exportEnable: true
      },
      {
        key: 'score', label: '分数线', exportLabel: '分数线', type: 'number', min: 0, max: 750,
        filterEnable: true, sortEnable: true, tableShow: true, exportEnable: true
      }
    ],
    defaultSort: { key: 'score', direction: 'desc' },
    pageSize: 50,
    exportFormat: 'csv'
  };
}

test('accepts a complete metadata document', () => {
  assert.deepEqual(validateMetadata(validMetadata()), { valid: true, errors: [] });
});

test('rejects duplicate field keys', () => {
  const metadata = validMetadata();
  metadata.fields.push({ ...metadata.fields[0] });
  assert.match(validateMetadata(metadata).errors.join('\n'), /字段 key 重复.*majorName/);
});

test('rejects a default sort key that is unavailable', () => {
  const metadata = validMetadata();
  metadata.defaultSort.key = 'unknown';
  assert.match(validateMetadata(metadata).errors.join('\n'), /默认排序字段.*unknown/);
});

test('rejects missing required source paths', () => {
  const metadata = validMetadata();
  delete metadata.yearSources[2026].planSource;
  assert.match(validateMetadata(metadata).errors.join('\n'), /2026.*planSource/);
});

test('rejects a default year outside supported years', () => {
  const metadata = validMetadata();
  metadata.defaultYear = 2027;
  assert.match(validateMetadata(metadata).errors.join('\n'), /默认年份.*2027/);
});

test('rejects reversed numeric bounds', () => {
  const metadata = validMetadata();
  metadata.fields[1].min = 800;
  assert.match(validateMetadata(metadata).errors.join('\n'), /score.*数值范围/);
});

test('rejects metadata without export columns', () => {
  const metadata = validMetadata();
  metadata.fields.forEach((field) => { field.exportEnable = false; });
  assert.match(validateMetadata(metadata).errors.join('\n'), /至少一个导出字段/);
});

test('loadMetadata reports HTTP failures with the metadata path', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404 });
  await assert.rejects(loadMetadata('metadata/missing.json', fetchImpl), /metadata\/missing\.json.*404/);
});

test('loadMetadata rejects invalid parsed metadata with friendly details', async () => {
  const metadata = validMetadata();
  metadata.fields = [];
  const fetchImpl = async () => ({ ok: true, json: async () => metadata });
  await assert.rejects(loadMetadata('metadata/school-data.json', fetchImpl), /元数据无效.*字段/);
});

test('metadata v2 expands yearly fields and requires score segment sources', () => {
  const metadata = validMetadata();
  metadata.schemaVersion = 2;
  metadata.yearSources[2026].scoreSegmentSource = 'data/segments-2026.json';
  metadata.yearFieldTemplates = [{
    key: 'score{year}', label: '{year}分数线', exportLabel: '{year}分数线', type: 'number', min: 0, max: 750,
    filterEnable: false, sortEnable: true, tableShow: true, exportEnable: true
  }];
  const expanded = expandMetadata(metadata);
  assert.equal(expanded.fields.at(-1).key, 'score2026');
  assert.deepEqual(validateMetadata(metadata), { valid: true, errors: [] });
  delete metadata.yearSources[2026].scoreSegmentSource;
  assert.match(validateMetadata(metadata).errors.join('\n'), /2026.*scoreSegmentSource/);
});

test('adding 2027 only changes metadata sources and supported years', () => {
  const metadata = validMetadata();
  metadata.schemaVersion = 2;
  metadata.supportedYears = [2026, 2027];
  metadata.yearSources[2026].scoreSegmentSource = 'data/segments-2026.json';
  metadata.yearSources[2027] = {
    mappingSource: 'data/mapping.json', scoreSource: 'data/scores-2027.json',
    planSource: 'data/plans-2027.json', scoreSegmentSource: 'data/segments-2027.json'
  };
  metadata.yearFieldTemplates = [{
    key: 'score{year}', label: '{year}分数线', exportLabel: '{year}分数线', type: 'number',
    filterEnable: false, sortEnable: true, tableShow: true, exportEnable: true
  }];
  assert.deepEqual(expandMetadata(metadata).fields.slice(-2).map((field) => field.key), ['score2026', 'score2027']);
});

test('derives latest and previous years from an unsorted metadata year list', () => {
  const metadata = { supportedYears: [2025, 2027, 2024, 2026], defaultYear: 2025 };
  assert.deepEqual(getSortedYears(metadata), [2024, 2025, 2026, 2027]);
  assert.equal(getLatestYear(metadata), 2027);
  assert.equal(getPreviousYear(metadata), 2026);
});

test('expanded metadata exposes derived years without treating defaultYear as latest', () => {
  const metadata = validMetadata();
  metadata.supportedYears = [2027, 2025, 2026];
  metadata.defaultYear = 2025;
  const expanded = expandMetadata(metadata);
  assert.equal(expanded.latestYear, 2027);
  assert.equal(expanded.previousYear, 2026);
  assert.deepEqual(expanded.supportedYears, [2025, 2026, 2027]);
});
