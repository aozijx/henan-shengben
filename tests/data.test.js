import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndexes,
  getCollegesByYear,
  getMasterRowsByYear,
  getMappingByYear,
  getScore,
  loadAll,
  loadYears,
  normalizedPlansForYears
} from '../js/data.js';

test('loadAll leaves yearly scores and plans unloaded at startup', async () => {
  const calls = [];
  const metadata = metadata2027();
  const store = await loadAll(metadata, createFetch(fixturePayloads(), calls));
  assert.deepEqual(calls, [metadata.yearSources[2027].mappingSource]);
  assert.deepEqual(store.plansByYear, {});
  assert.deepEqual(store.scoresByYear, {});
});

test('result plans are read after the selected years finish loading', async () => {
  const payloads = fixturePayloads();
  const store = await loadAll(metadata2027(), createFetch(payloads, []));
  assert.deepEqual(normalizedPlansForYears(store, [2027])[2027], []);

  await loadYears(store, [2027], createFetch(payloads, []));
  assert.equal(normalizedPlansForYears(store, [2027])[2027][0].schoolName, '测试大学');
  assert.equal(normalizedPlansForYears(store, [2027])[2027][0].planCount, 20);
});

test('yearly search reuses the already loaded query mapping when paths agree', async () => {
  const calls = [];
  const metadata = metadata2027({ queryIndexSource: 'fixtures/mapping-2027.json' });
  const fetchImpl = createFetch(fixturePayloads(), calls);
  const store = await loadAll(metadata, fetchImpl);
  await loadYears(store, [2027], fetchImpl);
  assert.deepEqual(calls, [
    'fixtures/mapping-2027.json',
    'fixtures/scores-2027.json',
    'fixtures/plans-2027.json'
  ]);
});

test('loading annual data does not replace a newer independent query mapping', async () => {
  const calls = [];
  const metadata = metadata2027({ queryIndexSource: 'fixtures/new-mapping.json' });
  metadata.queryMappingSource = 'fixtures/new-mapping.json';
  const payloads = fixturePayloads();
  payloads['fixtures/new-mapping.json'] = [{ 专科专业: '新专科', 可报本科专业: [] }];
  const fetchImpl = createFetch(payloads, calls);
  const store = await loadAll(metadata, fetchImpl);
  await loadYears(store, [2027], fetchImpl);
  assert.equal(getMappingByYear(2027)[0].专科专业, '新专科');
  assert.equal(store.mappingByYear[2027][0].专科专业, '软件技术');
});

function metadata2027(overrides = {}) {
  return {
    defaultYear: 2027,
    supportedYears: [2027],
    yearSources: {
      2027: {
        mappingSource: 'fixtures/mapping-2027.json',
        scoreSource: 'fixtures/scores-2027.json',
        planSource: 'fixtures/plans-2027.json',
        ...overrides
      }
    }
  };
}

function fixturePayloads() {
  return {
    'fixtures/mapping-2027.json': [
      { 专科专业: '软件技术', 可报本科专业: [{ 专业名称: '软件工程', 专业代号: '80', 代码6位: '080902' }] }
    ],
    'fixtures/scores-2027.json': [{ 专业代号: '80', 专业名称: '软件工程', 分数线: 188 }],
    'fixtures/plans-2027.json': [
      { 年度: 2027, 专业代号: '80', 专业名称: '软件工程', 院校名称: '测试大学', 办学性质: '公办', 计划人数: 20 }
    ]
  };
}

function createFetch(payloads, calls) {
  return async function fetchFixture(url) {
    calls.push(url);
    if (!(url in payloads)) return { ok: false, status: 404 };
    return { ok: true, json: async () => structuredClone(payloads[url]) };
  };
}

test('college lookup does not attach a sibling major with the same code', async () => {
  const metadata = metadata2027();
  const payloads = fixturePayloads();
  payloads['fixtures/plans-2027.json'] = [
    { 年度: 2027, 专业代号: '51', 专业名称: '计算机科学与技术', 院校名称: '甲大学', 计划人数: 2070 },
    { 年度: 2027, 专业代号: '51', 专业名称: '计算机应用工程', 院校名称: '乙大学', 计划人数: 150 }
  ];
  const store = await loadAll(metadata, createFetch(payloads, []));
  await loadYears(store, [2027], createFetch(payloads, []));
  const index = buildIndexes(store, metadata);
  assert.deepEqual(getCollegesByYear(index, 2027, { 专业代号: '51', 专业名称: '计算机应用工程（本科层次职业教育专业）' })
    .map(row => row.院校名称), ['乙大学']);
  assert.deepEqual(getCollegesByYear(index, 2027, { 专业代号: '51', 专业名称: '不存在的专业' }), []);
});

test('loads only the startup query index declared by metadata', async () => {
  const calls = [];
  const store = await loadAll(metadata2027(), createFetch(fixturePayloads(), calls));

  assert.deepEqual(calls, ['fixtures/mapping-2027.json']);
  assert.deepEqual(store.years, [2027]);
  assert.equal(store.mapping.length, 1);
  assert.equal(store.plansByYear[2027], undefined);
});

test('returns the mapping declared for the selected year', async () => {
  const metadata = metadata2027();
  metadata.supportedYears = [2026, 2027];
  metadata.defaultYear = 2026;
  metadata.yearSources[2026] = {
    mappingSource: 'fixtures/mapping-2026.json',
    scoreSource: 'fixtures/scores-2026.json',
    planSource: 'fixtures/plans-2026.json'
  };
  const payloads = fixturePayloads();
  payloads['fixtures/mapping-2026.json'] = [{ 专科专业: '软件技术', 可报本科专业: [{ 专业名称: '旧专业' }] }];
  payloads['fixtures/scores-2026.json'] = [];
  payloads['fixtures/plans-2026.json'] = [];
  const store = await loadAll(metadata, createFetch(payloads, []));
  await loadYears(store, [2027], createFetch(payloads, []));

  assert.equal(getMappingByYear(2026)[0].可报本科专业[0].专业名称, '旧专业');
  assert.equal(getMappingByYear(2027)[0].可报本科专业[0].专业名称, '软件工程');
});

test('a configured source failure names the exact path', async () => {
  const calls = [];
  const payloads = fixturePayloads();
  delete payloads['fixtures/plans-2027.json'];

  await assert.rejects(
    (async () => { const store = await loadAll(metadata2027(), createFetch(payloads, calls)); await loadYears(store, [2027], createFetch(payloads, calls)); })(),
    /fixtures\/plans-2027\.json.*404/
  );
});

test('builds a generic 2027 index without year-specific production code', async () => {
  const store = await loadAll(metadata2027(), createFetch(fixturePayloads(), []));
  await loadYears(store, [2027], createFetch(fixturePayloads(), []));
  const index = buildIndexes(store, metadata2027());
  const major = store.mapping[0].可报本科专业[0];

  assert.equal(store.plansByYear[2027].length, 1);
  assert.equal(getScore(index, major, 2027), 188);
  assert.equal(index.scoreByYear[2027]['80'].score, 188);
  assert.deepEqual(getCollegesByYear(index, 2027, major).map((row) => row.院校名称), ['测试大学']);
});

test('preserves the 99 to A1 professional-code alias', async () => {
  const payloads = fixturePayloads();
  payloads['fixtures/mapping-2027.json'][0].可报本科专业[0] = { 专业名称: '财务管理', 专业代号: '99' };
  payloads['fixtures/scores-2027.json'][0] = { 专业代号: '99', 专业名称: '财务管理', 分数线: 180 };
  payloads['fixtures/plans-2027.json'][0] = {
    年度: 2027, 专业代号: 'A1', 专业名称: '不同名称', 院校名称: '财经学院', 办学性质: '公办', 计划人数: 10
  };
  const store = await loadAll(metadata2027(), createFetch(payloads, []));
  await loadYears(store, [2027], createFetch(payloads, []));
  const index = buildIndexes(store, metadata2027());

  assert.equal(getCollegesByYear(index, 2027, { 专业名称: '财务管理', 专业代号: '99' })[0].院校名称, '财经学院');
});

test('master lookup requires the published six-digit major code when available', () => {
  const store = { years: [2027], scoresByYear: {}, plansByYear: {}, fallbacksByYear: {
    2027: [
      { 专业代码: '130401', 专业名称: '美术学', 学校名称: '甲大学', 艺术: '是' },
      { 专业代码: '130402', 专业名称: '美术学', 学校名称: '乙大学', 艺术: '是' }
    ]
  } };
  const index = buildIndexes(store, { supportedYears: [2027] });
  assert.deepEqual(getMasterRowsByYear(index, 2027, { 专业名称: '美术学', 代码6位: '130401' })
    .map((row) => row.学校名称), ['甲大学']);
  assert.deepEqual(getMasterRowsByYear(index, 2027, { 专业名称: '美术学', 代码6位: '130499' }), []);
});

test('score lookup does not assign a merged-name score by substring', () => {
  const index = { scoreByYear: { 2027: { '51': { name: '软件工程（含方向）', score: 180 } } } };
  assert.equal(getScore(index, { 专业代号: '52', 专业名称: '软件工程' }, 2027), null);
});
