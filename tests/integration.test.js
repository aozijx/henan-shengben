import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bootstrapData } from '../js/bootstrap.js';
import { buildMajorAggregates } from '../js/aggregate.js';
import { buildExplorerControlsHtml, canExport, createInitialState, reduceExplorerState } from '../js/explorer.js';
import { buildExportFilename, prepareExport, serializeCsv } from '../js/export.js';
import { buildResultModel } from '../js/result-model.js';
import { buildResultWorkspaceHtml } from '../js/results-view.js';
import { normalizeCollegeMasterRow, normalizeMajorOption, normalizePlanEntry } from '../js/model.js';

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

test('a metadata-only new year flows through selection, result table and export', async () => {
  const loaded = await bootstrapData('fixtures/metadata-2027.json', await fixtureFetch());
  const mapping = await loaded.data.ensureQueryIndex(2027);
  const yearData = await loaded.data.ensureYear(2027);
  const majors = mapping[0].可报本科专业.map((major) => normalizeMajorOption(major));
  const state = reduceExplorerState(createInitialState(loaded.metadata), { type: 'LOAD_SUCCESS' }, loaded.metadata);
  const aggregates = buildMajorAggregates({
    majors,
    years: loaded.metadata.supportedYears,
    scoresByYear: { 2027: yearData.scores },
    plansByYear: { 2027: yearData.plans.map(normalizePlanEntry) },
    planPublishedByYear: { 2027: yearData.planPublished },
    scorePublishedByYear: { 2027: yearData.scorePublished },
    fallbacksByYear: { 2027: yearData.colleges.map((row) => normalizeCollegeMasterRow(row, yearData.planPublished)) }
  });
  const result = buildResultModel({ aggregates, metadata: loaded.metadata,
    selectedYears: state.selectedYears, filters: state.filters, sort: state.sort });
  const exported = prepareExport({ ...result, status: 'ready' }, loaded.metadata, state.focusYear);
  const csv = serializeCsv(exported.rows, exported.fields);
  const tableHtml = buildResultWorkspaceHtml({
    status: 'ready', hasQuery: true, aggregates: aggregates,
    selectedYears: state.selectedYears, resultLayout: 'table'
  }, loaded.metadata);

  assert.deepEqual(loaded.metadata.supportedYears, [2027]);
  assert.deepEqual(state.selectedYears, loaded.metadata.supportedYears);
  assert.equal(state.focusYear, loaded.metadata.defaultYear);
  assert.deepEqual(result.allRows.map((row) => row.majorName), ['数据工程', '智能工程']);
  assert.deepEqual(result.selectedYears, loaded.metadata.supportedYears);
  assert.match(buildExplorerControlsHtml(loaded.metadata, state), /year-selection-dialog/);
  assert.doesNotMatch(tableHtml, /year-selection-dialog/);
  assert.match(tableHtml, /data-result-sort="score2027" aria-label="按2027 年省控线排序"/);
  assert.match(tableHtml, /class="(?:sortable )?score-year-column"[^>]*>(?:<button[^>]*>)?2027 年/);
  assert.match(tableHtml, /class="admission-year-label">2027 年 <span class="year-kind-public">公办<\/span>\/<span class="year-kind-private">民办<\/span>/);
  assert.doesNotMatch(tableHtml, /<th>2027 省控线<\/th>/);
  assert.match(csv, /^\uFEFF本科专业,2027分数线,2027院校数\(公\/民\),2027计划人数\(公\/民\)\r\n数据工程,220,0\/1,0\/0\r\n智能工程,180,1\/0,20\/0/);
  assert.equal(buildExportFilename(state.focusYear, new Date(2026, 9, 21)), '院校数据_2027_20261021.csv');
});

test('bootstrap requests metadata and the default query index once each', async () => {
  const calls = [];
  const fetchImpl = await fixtureFetch();
  const loaded = await bootstrapData('fixtures/metadata-2027.json', async (url, options) => {
    calls.push(url);
    return fetchImpl(url, options);
  });
  await loaded.repository.ensureQueryIndex(2027);
  assert.deepEqual(calls, ['fixtures/metadata-2027.json', 'fixtures/mapping-2027.json']);
});

test('a missing configured source names its path and leaves export disabled', async () => {
  const metadata = await fixture('metadata-2027.json');
  metadata.yearSources[2027].planSource = 'fixtures/missing-plans-2027.json';
  const fetchImpl = await fixtureFetch({ 'fixtures/metadata-2027.json': metadata });
  await assert.rejects(
    (async () => { const loaded = await bootstrapData('fixtures/metadata-2027.json', fetchImpl); await loaded.data.ensureYear(2027); })(),
    /fixtures\/missing-plans-2027\.json.*404/
  );

  const failed = reduceExplorerState(createInitialState(metadata), { type: 'LOAD_ERROR', error: '加载失败' }, metadata);
  assert.equal(canExport({ ...failed, rows: [{ majorName: '不应导出' }] }), false);
});
