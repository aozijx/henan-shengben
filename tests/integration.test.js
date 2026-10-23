import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bootstrapData } from '../js/bootstrap.js';
import { buildMajorAggregates } from '../js/aggregate.js';
import { canExport, createInitialState, reduceExplorerState } from '../js/explorer.js';
import { buildExportFilename, prepareExport, serializeCsv } from '../js/export.js';
import { createPreviewModel } from '../js/preview.js';
import { buildResultWorkspaceHtml } from '../js/results-view.js';
import { normalizeMajorOption, normalizePlanEntry } from '../js/model.js';

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

test('a metadata-only new year flows through selection, table, preview and export', async () => {
  const loaded = await bootstrapData('fixtures/metadata-2027.json', await fixtureFetch());
  const majors = loaded.store.mapping[0].可报本科专业.map((major) => normalizeMajorOption(major));
  const state = reduceExplorerState(createInitialState(loaded.metadata), { type: 'LOAD_SUCCESS' }, loaded.metadata);
  const aggregates = buildMajorAggregates({
    majors,
    years: loaded.metadata.supportedYears,
    scoresByYear: loaded.store.scoresByYear,
    plansByYear: Object.fromEntries(loaded.metadata.supportedYears.map((year) => [
      year, (loaded.store.plansByYear[year] || []).map(normalizePlanEntry)
    ])),
    fallbacksByYear: loaded.store.fallbacksByYear
  });
  const preview = createPreviewModel(aggregates, loaded.metadata, { ...state, status: 'ready', hasSearch: true });
  const exported = prepareExport(preview, loaded.metadata, state.focusYear);
  const csv = serializeCsv(exported.rows, exported.fields);
  const tableHtml = buildResultWorkspaceHtml({
    status: 'ready', hasQuery: true, aggregates: aggregates,
    selectedYears: state.selectedYears, resultLayout: 'table'
  }, loaded.metadata);

  assert.deepEqual(loaded.store.years, [2027]);
  assert.deepEqual(state.selectedYears, loaded.metadata.supportedYears);
  assert.equal(state.focusYear, loaded.metadata.defaultYear);
  assert.deepEqual(preview.allRows.map((row) => row.majorName), ['数据工程', '智能工程']);
  assert.deepEqual(preview.selectedYears, loaded.metadata.supportedYears);
  assert.match(tableHtml, /year-selection-dialog/);
  assert.match(tableHtml, /2027 省控线/);
  assert.match(csv, /^\uFEFF本科专业,2027分数线,2027院校数\(公\/民\),2027计划人数\(公\/民\)\r\n数据工程,220,0\/1,0\/0\r\n智能工程,180,1\/0,20\/0/);
  assert.equal(buildExportFilename(state.focusYear, new Date(2026, 9, 21)), '院校数据_2027_20261021.csv');
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
