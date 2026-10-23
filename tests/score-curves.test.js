import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCurve, lookupScoreSegmentCode } from '../js/score-curves.js';

test('score curves preserve missing and normalize cumulative counts', () => {
  const shard = { segments: [{ score: 200, segmentCount: 2, cumulativeCount: 2 }, { score: 199, segmentCount: 3, cumulativeCount: 5 }] };
  assert.deepEqual(buildCurve(shard, 'percent'), [[200, 40], [199, 100]]);
  assert.deepEqual(buildCurve(shard, 'rank'), [[2, 200], [5, 199]]);
  assert.deepEqual(buildCurve(null, 'rank'), []);
});

test('score segment index skips unpublished shards and resolves 99/A1 aliases', () => {
  const index = { majors: [{ majorCode: 'A1' }, { majorCode: '51' }] };
  assert.equal(lookupScoreSegmentCode(index, '99'), 'A1');
  assert.equal(lookupScoreSegmentCode(index, '51'), '51');
  assert.equal(lookupScoreSegmentCode(index, '52'), null);
});
