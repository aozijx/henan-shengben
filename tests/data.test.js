import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndexes,
  getCollegesByYear,
  getScore,
  getYearData,
  loadAll
} from '../js/data.js';

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

test('loads only source paths and years declared by metadata', async () => {
  const calls = [];
  const store = await loadAll(metadata2027(), createFetch(fixturePayloads(), calls));

  assert.deepEqual(calls.sort(), [
    'fixtures/mapping-2027.json',
    'fixtures/plans-2027.json',
    'fixtures/scores-2027.json'
  ]);
  assert.deepEqual(store.years, [2027]);
  assert.equal(store.mapping.length, 1);
  assert.equal(store.plansByYear[2027][0].院校名称, '测试大学');
});

test('a configured source failure names the exact path', async () => {
  const calls = [];
  const payloads = fixturePayloads();
  delete payloads['fixtures/plans-2027.json'];

  await assert.rejects(
    loadAll(metadata2027(), createFetch(payloads, calls)),
    /fixtures\/plans-2027\.json.*404/
  );
});

test('builds a generic 2027 index without year-specific production code', async () => {
  const store = await loadAll(metadata2027(), createFetch(fixturePayloads(), []));
  const index = buildIndexes(store, metadata2027());
  const major = store.mapping[0].可报本科专业[0];

  assert.equal(getYearData(index, 2027).plans.length, 1);
  assert.equal(getScore(index, major, 2027), 188);
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
  const index = buildIndexes(store, metadata2027());

  assert.equal(getCollegesByYear(index, 2027, { 专业名称: '财务管理', 专业代号: '99' })[0].院校名称, '财经学院');
});
