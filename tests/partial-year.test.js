import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDataContext } from '../js/data.js';
import { expandMetadata, getSelectableYears } from '../js/metadata.js';
import { queryRowsFromPublishedSources } from '../js/analytics-query.js';
import { buildPreviewRows } from '../js/pipeline.js';
import { buildMajorAggregates } from '../js/aggregate.js';
import { buildResultModel } from '../js/result-model.js';
import { normalizeMajorOption } from '../js/model.js';
import { buildYearSummaryHtml } from '../js/year-stack.js';
import { createInitialState } from '../js/explorer-state.js';
import { getExportFields } from '../js/export.js';

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('2027 mapping and college master are searchable before plans and score tables publish', () => {
  const metadata = json('../metadata/school-data.json');
  const mapping = json('../data/专业对照/专业对照_2027.json');
  const colleges = json('../data/招生高校及专业/招生高校及专业_2027.json');
  assert.ok(getSelectableYears(metadata).includes(2027));
  assert.equal(metadata.supportedYears.includes(2027), false);
  const expanded = expandMetadata(metadata);
  assert.ok(createInitialState(expanded).selectedYears.includes(2027));
  assert.ok(getExportFields(expanded, [2027]).some((field) => field.key === 'schoolSplit2027'));
  assert.ok(getExportFields(expanded, [2027]).every((field) => !field.key.endsWith('2026')));

  const schoolMajorNames = new Set(colleges.map((row) => row['专业名称']));
  const specialty = mapping.find((row) => row['可报本科专业'].some((major) => schoolMajorNames.has(major['专业名称'])));
  const major = specialty['可报本科专业'].find((item) => schoolMajorNames.has(item['专业名称']));
  const source = queryRowsFromPublishedSources({}, { 2027: { plans: [], colleges, planPublished: false,
    scores: [], scorePublished: false } }, [2027]);
  const data = createDataContext({});
  data.setSummaryStore(source);
  const schoolRows = data.getColleges(major, 2027);
  assert.ok(schoolRows.length > 0);

  const preview = buildPreviewRows({ majors: [major], years: [2027], filters: { povertyStatus: '否' },
    planPublishedByYear: source.planPublishedByYear,
    getScore: (item, year) => data.getScore(item, year),
    getPlans: (item, year) => data.getColleges(item, year) });
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].schoolCount2027, new Set(schoolRows.map((row) => row['院校代码'])).size);
  assert.equal(preview.rows[0].planCount2027, null);
  assert.equal(preview.rows[0].score2027, null);

  const aggregates = buildMajorAggregates({ majors: [normalizeMajorOption(major)], years: [2027],
    plansByYear: source.plansByYear, fallbacksByYear: source.fallbacksByYear,
    scoresByYear: source.scoresByYear, planPublishedByYear: source.planPublishedByYear,
    scorePublishedByYear: source.scorePublishedByYear });
  const result = buildResultModel({ aggregates, metadata, selectedYears: [2027], filters: { povertyStatus: '否' } });
  assert.equal(result.aggregates.length, 1);
  assert.match(buildYearSummaryHtml(result.aggregates[0].years[2027]), /招生计划人数未公布/);
  assert.match(buildYearSummaryHtml(result.aggregates[0].years[2027]), /未公布/);
});
