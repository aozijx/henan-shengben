import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataContext } from '../js/data.js';
import { createDataRepository } from '../js/data-source.js';

function contextFor(metadata, payloads, calls = []) {
  const repository = createDataRepository(metadata, createFetch(payloads, calls));
  return createDataContext(repository);
}

test('query index loads before yearly plans and scores', async () => {
  const calls = [];
  const metadata = metadata2027();
  const data = contextFor(metadata, fixturePayloads(), calls);
  await data.ensureQueryIndex(metadata.defaultYear);
  assert.deepEqual(calls, [metadata.yearSources[2027].mappingSource]);
});

test('year data is loaded on demand and indexed after loading', async () => {
  const payloads = fixturePayloads();
  const data = contextFor(metadata2027(), payloads);
  assert.deepEqual(data.getColleges({ 专业代号: '80', 专业名称: '软件工程' }, 2027), []);

  const year = await data.ensureYear(2027);
  assert.equal(year.plans.length, 1);
  assert.equal(data.getColleges({ 专业代号: '80', 专业名称: '软件工程' }, 2027)[0].院校名称, '测试大学');
});

test('yearly lookup reuses the already loaded query mapping when paths agree', async () => {
  const calls = [];
  const metadata = metadata2027({ queryIndexSource: 'fixtures/mapping-2027.json' });
  const data = contextFor(metadata, fixturePayloads(), calls);
  await data.ensureQueryIndex(2027);
  await data.ensureYear(2027);
  assert.deepEqual(calls, [
    'fixtures/mapping-2027.json',
    'fixtures/scores-2027.json',
    'fixtures/plans-2027.json'
  ]);
});

test('year data does not replace the independent query mapping', async () => {
  const calls = [];
  const metadata = metadata2027({ queryIndexSource: 'fixtures/new-mapping.json' });
  metadata.queryMappingSource = 'fixtures/new-mapping.json';
  const payloads = fixturePayloads();
  payloads['fixtures/new-mapping.json'] = [{ 专科专业: '新专科', 可报本科专业: [] }];
  const data = contextFor(metadata, payloads, calls);
  await data.ensureQueryIndex(2027);
  await data.ensureYear(2027);
  assert.equal(data.getMapping(2027)[0].专科专业, '新专科');
  assert.deepEqual(calls, ['fixtures/new-mapping.json', 'fixtures/scores-2027.json', 'fixtures/plans-2027.json']);
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
  const data = contextFor(metadata, payloads);
  await data.ensureYear(2027);
  assert.deepEqual(data.getColleges({ 专业代号: '51', 专业名称: '计算机应用工程（本科层次职业教育专业）' }, 2027)
    .map(row => row.院校名称), ['乙大学']);
  assert.deepEqual(data.getColleges({ 专业代号: '51', 专业名称: '不存在的专业' }, 2027), []);
});

test('bootstrap data context loads only the startup query index', async () => {
  const calls = [];
  const data = contextFor(metadata2027(), fixturePayloads(), calls);
  await data.ensureQueryIndex(2027);
  assert.deepEqual(calls, ['fixtures/mapping-2027.json']);
  assert.equal(data.getMapping(2027).length, 1);
});

test('returns the query mapping declared for the selected year', async () => {
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
  const data = contextFor(metadata, payloads);
  await data.ensureQueryIndex(2026);
  await data.ensureQueryIndex(2027);

  assert.equal(data.getMapping(2026)[0].可报本科专业[0].专业名称, '旧专业');
  assert.equal(data.getMapping(2027)[0].可报本科专业[0].专业名称, '软件工程');
});

test('a configured source failure names the exact path', async () => {
  const calls = [];
  const payloads = fixturePayloads();
  delete payloads['fixtures/plans-2027.json'];
  const data = contextFor(metadata2027(), payloads, calls);
  await assert.rejects(data.ensureYear(2027), /fixtures\/plans-2027\.json.*404/);
});

test('builds a generic year index without year-specific production code', async () => {
  const data = contextFor(metadata2027(), fixturePayloads());
  const mapping = await data.ensureQueryIndex(2027);
  const year = await data.ensureYear(2027);
  const major = mapping[0].可报本科专业[0];

  assert.equal(year.plans.length, 1);
  assert.equal(data.getScore(major, 2027), 188);
  assert.deepEqual(data.getColleges(major, 2027).map((row) => row.院校名称), ['测试大学']);
});

test('preserves the 99 to A1 professional-code alias', async () => {
  const payloads = fixturePayloads();
  payloads['fixtures/mapping-2027.json'][0].可报本科专业[0] = { 专业名称: '财务管理', 专业代号: '99' };
  payloads['fixtures/scores-2027.json'][0] = { 专业代号: '99', 专业名称: '财务管理', 分数线: 180 };
  payloads['fixtures/plans-2027.json'][0] = {
    年度: 2027, 专业代号: 'A1', 专业名称: '不同名称', 院校名称: '财经学院', 办学性质: '公办', 计划人数: 10
  };
  const data = contextFor(metadata2027(), payloads);
  await data.ensureYear(2027);
  assert.equal(data.getColleges({ 专业名称: '财务管理', 专业代号: '99' }, 2027)[0].院校名称, '财经学院');
});

test('master lookup requires the published six-digit major code when available', async () => {
  const metadata = metadata2027();
  const payloads = fixturePayloads();
  payloads['fixtures/plans-2027.json'] = [];
  payloads['fixtures/scores-2027.json'] = [];
  payloads['fixtures/colleges-2027.json'] = [
    { 专业代码: '130401', 专业名称: '美术学', 学校名称: '甲大学', 艺术: '是' },
    { 专业代码: '130402', 专业名称: '美术学', 学校名称: '乙大学', 艺术: '是' }
  ];
  metadata.sourceCatalog = { colleges: { 2027: 'fixtures/colleges-2027.json' } };
  const data = contextFor(metadata, payloads);
  await data.ensureYear(2027);
  assert.deepEqual(data.getMasterRows({ 专业名称: '美术学', 代码6位: '130401' }, 2027)
    .map((row) => row.学校名称), ['甲大学']);
  assert.deepEqual(data.getMasterRows({ 专业名称: '美术学', 代码6位: '130499' }, 2027), []);
});

test('score lookup does not assign a merged-name score by substring', () => {
  const data = contextFor(metadata2027(), fixturePayloads());
  data.setSummaryStore({ years: [2027], scoresByYear: {
    2027: [{ 专业代号: '51', 专业名称: '软件工程（含方向）', 分数线: 180 }]
  }, plansByYear: {}, fallbacksByYear: {} });
  assert.equal(data.getScore({ 专业代号: '52', 专业名称: '软件工程' }, 2027), null);
});
