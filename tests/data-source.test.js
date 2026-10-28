import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataRepository } from '../js/data-source.js';

test('analytics and a chosen major shard are loaded only on demand', async () => {
  const calls = [];
  const repository = createDataRepository({ yearSources: { 2027: {
    queryIndexSource: 'mapping.json', analyticsSource: 'analytics.json',
    scoreSegmentIndexSource: 'index.json', scoreSegmentShardTemplate: 'shards/2027/{majorCode}.json'
  } } }, async (url) => { calls.push(url); return { ok: true, json: async () => ({ url }) }; });
  await repository.ensureQueryIndex(2027);
  assert.deepEqual(calls, ['mapping.json']);
  await repository.ensureAnalytics(2027);
  await repository.ensureScoreSegment(2027, '51');
  await repository.ensureScoreSegment(2027, '51');
  assert.deepEqual(calls, ['mapping.json', 'analytics.json', 'shards/2027/51.json']);
});

function metadata() {
  return {
    defaultYear: 2027,
    supportedYears: [2027],
    yearSources: { 2027: {
      queryIndexSource: 'index.json', mappingSource: 'mapping.json', scoreSource: 'scores.json',
      planSource: 'plans.json', scoreSegmentShardTemplate: 'shards/{majorCode}.json'
    } }
  };
}

test('repository is lazy and shares one fetch for the same URL', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, json: async () => ({ url }) }; };
  const config = metadata();
  delete config.yearSources[2027].queryIndexSource;
  const repository = createDataRepository(config, fetchImpl);
  assert.deepEqual(calls, []);
  await Promise.all([repository.ensureQueryIndex(2027), repository.ensureQueryIndex(2027)]);
  assert.deepEqual(calls, ['mapping.json']);
});

test('first-screen query index does not request plans or score segments', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, json: async () => [] }; };
  const repository = createDataRepository(metadata(), fetchImpl);
  await repository.ensureQueryIndex(2027);
  assert.deepEqual(calls, ['index.json']);
});

test('latest mapping and a master-only college year load independently of annual plans', async () => {
  const calls = [];
  const config = metadata();
  config.queryMappingYear = 2028;
  config.queryMappingSource = 'mapping-2028.json';
  config.sourceCatalog = { colleges: { 2028: 'colleges-2028.json' }, plans: {} };
  const repository = createDataRepository(config, async (url) => {
    calls.push(url);
    return { ok: true, json: async () => [{ source: url }] };
  });
  assert.deepEqual(await repository.ensureQueryIndex(2027), [{ source: 'mapping-2028.json' }]);
  assert.deepEqual(await repository.ensureCollegeYear(2028), {
    plans: [], colleges: [{ source: 'colleges-2028.json' }], scores: [],
    planPublished: false, scorePublished: false
  });
  assert.deepEqual(calls, ['mapping-2028.json', 'colleges-2028.json']);
});

test('published year can load its college master without loading detailed plans', async () => {
  const calls = [];
  const config = metadata();
  config.sourceCatalog = { colleges: { 2027: 'colleges.json' }, plans: { 2027: 'plans.json' } };
  const repository = createDataRepository(config, async (url) => {
    calls.push(url);
    return { ok: true, json: async () => [{ source: url }] };
  });
  assert.deepEqual(await repository.ensureCollegeMaster(2027), [{ source: 'colleges.json' }]);
  assert.deepEqual(calls, ['colleges.json']);
});

test('retry evicts a failed URL and requests it again', async () => {
  let attempt = 0;
  const repository = createDataRepository(metadata(), async () => {
    attempt += 1;
    return attempt === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => [] };
  });
  await assert.rejects(repository.ensureScoreSegment(2027, '51'), /shards\/51\.json.*503/);
  await repository.retry('shards/51.json');
  assert.equal(attempt, 2);
});
