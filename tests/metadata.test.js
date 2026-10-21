import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMetadata, validateMetadata } from '../js/metadata.js';

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
    scorePresets: [{ label: '200 分以上', min: 200, max: 750 }],
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
