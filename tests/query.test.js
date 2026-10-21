import test from 'node:test';
import assert from 'node:assert/strict';
import { doQuery, findMappingMatches } from '../js/query.js';
import { loadAll } from '../js/data.js';

test('searches only the mapping supplied for the selected year', () => {
  const mapping2026 = [{ 专科专业: '软件技术', 可报本科专业: [{ 专业名称: '旧专业' }] }];
  const mapping2027 = [{ 专科专业: '软件技术', 可报本科专业: [{ 专业名称: '新专业' }] }];

  assert.equal(findMappingMatches(mapping2026, '软件')[0].可报本科专业[0].专业名称, '旧专业');
  assert.equal(findMappingMatches(mapping2027, '软件')[0].可报本科专业[0].专业名称, '新专业');
});

test('completes a successful partial query to the selected specialty name', async () => {
  const metadata = {
    defaultYear: 2027,
    supportedYears: [2027],
    yearSources: {
      2027: { mappingSource: 'mapping.json', scoreSource: 'scores.json', planSource: 'plans.json' }
    }
  };
  const payloads = {
    'mapping.json': [{ 专科专业: '物联网应用技术', 可报本科专业: [] }],
    'scores.json': [],
    'plans.json': []
  };
  await loadAll(metadata, async (url) => ({ ok: true, json: async () => structuredClone(payloads[url]) }));
  const input = { value: '物联网' };
  const hint = { textContent: '' };
  const result = { innerHTML: '' };

  doQuery(input, hint, result);

  assert.equal(input.value, '物联网应用技术');
  assert.match(hint.textContent, /物联网应用技术/);
});
