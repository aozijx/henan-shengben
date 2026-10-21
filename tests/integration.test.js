import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bootstrapData } from '../js/bootstrap.js';
import { getCollegesByYear, getScore } from '../js/data.js';
import { canExport, createInitialState, reduceExplorerState } from '../js/explorer.js';
import { buildExportFilename, getExportFields, serializeCsv } from '../js/export.js';
import { buildPreviewRows, sortPreviewRows } from '../js/pipeline.js';

async function fixture(name) {
  return JSON.parse(await readFile(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
}

async function fixtureFetch(overrides = {}) {
  const payloads = {
    'fixtures/mapping-2027.json': await fixture('mapping-2027.json'),
    'fixtures/scores-2027.json': await fixture('scores-2027.json'),
    'fixtures/plans-2027.json': await fixture('plans-2027.json'),
    'fixtures/metadata-2027.json': await fixture('metadata-2027.json'),
    ...overrides
  };
  return async function fetchFixture(url) {
    if (!(url in payloads)) return { ok: false, status: 404 };
    return { ok: true, json: async () => structuredClone(payloads[url]) };
  };
}

test('a metadata-only new year flows through load, filter, sort, preview and export', async () => {
  const loaded = await bootstrapData('fixtures/metadata-2027.json', await fixtureFetch());
  const majors = loaded.store.mapping[0].可报本科专业;
  const preview = buildPreviewRows({
    majors,
    years: loaded.metadata.supportedYears,
    filters: { schoolType: '全部', povertyStatus: '全部', subject: '全部', schoolCount: '' },
    getScore: (major, year) => getScore(loaded.index, major, year),
    getPlans: (major, year) => getCollegesByYear(loaded.index, year, major)
  });
  const rows = sortPreviewRows(preview.rows, loaded.metadata.defaultSort);
  const csv = serializeCsv(rows, getExportFields(loaded.metadata));

  assert.deepEqual(loaded.store.years, [2027]);
  assert.deepEqual(rows.map((row) => row.majorName), ['数据工程', '智能工程']);
  assert.match(csv, /^\uFEFF本科专业,2027分数线,2027院校数,2027计划人数\r\n数据工程,220,1,15\r\n智能工程,180,1,20/);
  assert.equal(buildExportFilename(loaded.metadata.defaultYear, new Date(2026, 9, 21)), '院校数据_2027_20261021.csv');
});

test('a missing configured source names its path and leaves export disabled', async () => {
  const metadata = await fixture('metadata-2027.json');
  metadata.yearSources[2027].planSource = 'fixtures/missing-plans-2027.json';
  const fetchImpl = await fixtureFetch({ 'fixtures/metadata-2027.json': metadata });
  await assert.rejects(
    bootstrapData('fixtures/metadata-2027.json', fetchImpl),
    /fixtures\/missing-plans-2027\.json.*404/
  );

  const failed = reduceExplorerState(createInitialState(metadata), { type: 'LOAD_ERROR', error: '加载失败' }, metadata);
  assert.equal(canExport({ ...failed, rows: [{ majorName: '不应导出' }] }), false);
});
