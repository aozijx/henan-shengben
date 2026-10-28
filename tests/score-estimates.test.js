import test from 'node:test';
import assert from 'node:assert/strict';
import * as scoreEstimates from '../js/score-estimates.js';
import { createDataRepository } from '../js/data-source.js';

test('loads matching yearly score shards and estimates the filtered major table rows', async () => {
  const metadata = { yearSources: {
    2026: { scoreSegmentIndexSource: 'index.json', scoreSegmentShardTemplate: 'shards/{majorCode}.json' },
    2027: {}
  } };
  const documents = {
    'index.json': { majors: [{ majorCode: '80', status: 'ok' }] },
    'shards/80.json': { majorCode: '80', segments: [
      { score: 210, cumulativeCount: 4 }, { score: 200, cumulativeCount: 12 }
    ] }
  };
  const requested = [];
  const repository = createDataRepository(metadata, async (url) => {
    requested.push(url);
    return { ok: true, json: async () => documents[url] };
  });
  const aggregates = [{ major: { majorCode: '80' }, years: {
    2026: { planPublished: true, schools: [{ ordinaryPlanCount: 8 }] },
    2027: { planPublished: false, schools: [] }
  } }];
  assert.equal(typeof scoreEstimates.loadEstimatedScores, 'function');
  const enriched = await scoreEstimates.loadEstimatedScores(aggregates, [2026, 2027], metadata, repository);
  assert.equal(enriched[0].years[2026].estimatedMinScore, 200);
  assert.equal(enriched[0].years[2027].estimatedMinScore, null);
  assert.deepEqual(requested, ['index.json', 'shards/80.json']);
  assert.equal(aggregates[0].years[2026].estimatedMinScore, undefined);
});

test('empty result rows do not load score segment indexes', async () => {
  const metadata = { yearSources: { 2026: {
    scoreSegmentIndexSource: 'index.json', scoreSegmentShardTemplate: 'shards/{majorCode}.json'
  } } };
  let requests = 0;
  const repository = createDataRepository(metadata, async () => {
    requests += 1;
    throw new Error('unexpected request');
  });
  assert.deepEqual(await scoreEstimates.loadEstimatedScores([], [2026], metadata, repository), []);
  assert.equal(requests, 0);
});
