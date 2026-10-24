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

test('repository is lazy and shares one promise for the same URL', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, json: async () => ({ url }) }; };
  const repository = createDataRepository(metadata(), fetchImpl);
  assert.deepEqual(calls, []);
  const first = repository.ensureMapping(2027);
  const second = repository.ensureMapping(2027);
  assert.equal(first, second);
  await first;
  assert.deepEqual(calls, ['mapping.json']);
});

test('first-screen query index does not request plans or score segments', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, json: async () => [] }; };
  const repository = createDataRepository(metadata(), fetchImpl);
  await repository.ensureQueryIndex(2027);
  assert.deepEqual(calls, ['index.json']);
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
