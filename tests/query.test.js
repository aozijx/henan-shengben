import test from 'node:test';
import assert from 'node:assert/strict';
import { doQuery, findMappingMatches, resolveMappingMatch, setQueryYear, setResultListener } from '../js/query.js';
import { loadAll, loadYears } from '../js/data.js';

function createResultRoot() {
  const slots = {
    '#result-state': { hidden: true, className: '', textContent: '' },
    '#result-content': { hidden: true },
    '#result-toolbar': { hidden: true }
  };
  return {
    innerHTML: '',
    classList: { remove() {} },
    querySelector(selector) { return slots[selector] || null; },
    querySelectorAll() { return []; }
  };
}

test('searches only the mapping supplied for the selected year', () => {
  const mapping2026 = [{ 专科专业: '软件技术', 可报本科专业: [{ 专业名称: '旧专业' }] }];
  const mapping2027 = [{ 专科专业: '软件技术', 可报本科专业: [{ 专业名称: '新专业' }] }];

  assert.equal(findMappingMatches(mapping2026, '软件')[0].可报本科专业[0].专业名称, '旧专业');
  assert.equal(findMappingMatches(mapping2027, '软件')[0].可报本科专业[0].专业名称, '新专业');
});

test('prefers an exact specialty name before completing a partial match', () => {
  const mapping = [
    { 专科专业: '软件技术（开发）', 可报本科专业: [] },
    { 专科专业: '软件技术', 可报本科专业: [] }
  ];
  assert.equal(resolveMappingMatch(mapping, '软件技术')['专科专业'], '软件技术');
  assert.equal(resolveMappingMatch(mapping, '软件')['专科专业'], '软件技术（开发）');
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
  const result = createResultRoot();

  doQuery(input, hint, result);

  assert.equal(input.value, '物联网应用技术');
  assert.match(hint.textContent, /物联网应用技术/);
});

test('switches completion and context to the focused query year', async () => {
  const metadata = {
    defaultYear: 2026,
    supportedYears: [2024, 2026],
    yearSources: {
      2024: { mappingSource: 'mapping-2024.json', scoreSource: 'scores-2024.json', planSource: 'plans-2024.json' },
      2026: { mappingSource: 'mapping-2026.json', scoreSource: 'scores-2026.json', planSource: 'plans-2026.json' }
    }
  };
  const payloads = {
    'mapping-2024.json': [{ 专科专业: '软件技术（2024）', 可报本科专业: [] }],
    'mapping-2026.json': [{ 专科专业: '软件技术（2026）', 可报本科专业: [] }],
    'scores-2024.json': [], 'scores-2026.json': [], 'plans-2024.json': [], 'plans-2026.json': []
  };
  const store = await loadAll(metadata, async (url) => ({ ok: true, json: async () => structuredClone(payloads[url]) }));
  await loadYears(store, [2024], async (url) => ({ ok: true, json: async () => structuredClone(payloads[url]) }));
  setQueryYear(2024);
  const input = { value: '软件技术' };
  const hint = { textContent: '' };
  doQuery(input, hint, createResultRoot());
  assert.equal(input.value, '软件技术（2024）');
  assert.match(hint.textContent, /2024 对照一览表/);
});

test('hands successful matches to the aggregate workspace without legacy table markup', async () => {
  const metadata = {
    defaultYear: 2027,
    supportedYears: [2027],
    yearSources: { 2027: { mappingSource: 'mapping.json', scoreSource: 'scores.json', planSource: 'plans.json' } }
  };
  const payloads = {
    'mapping.json': [{ 专科专业: '软件技术', 可报本科专业: [{ 专业名称: '软件工程' }] }],
    'scores.json': [], 'plans.json': []
  };
  await loadAll(metadata, async (url) => ({ ok: true, json: async () => structuredClone(payloads[url]) }));
  const input = { value: '软件' };
  const hint = { textContent: '' };
  const result = createResultRoot();
  let received = null;
  setResultListener((majors, name) => { received = { majors, name }; });

  doQuery(input, hint, result);

  assert.equal(input.value, '软件技术');
  assert.equal(received.name, '软件技术');
  assert.equal(received.majors[0].专业名称, '软件工程');
  assert.equal(result.innerHTML, '');
  setResultListener(null);
});
