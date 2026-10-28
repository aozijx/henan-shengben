/* 数据加载、索引与读取。数据源和年份完全由 metadata 声明。 */
import { normCode6, schoolName } from './utils.js';
import { createDataRepository } from './data-source.js';
import { getSelectableYears } from './metadata.js';
import { normalizeCollegeMasterRow, normalizePlanEntry } from './model.js';
import { normalizeMajorName, selectMajorRows } from './major-match.js';

export var YEARS = [];
export var SCORE_BY_YEAR = {};
export var MAPPING = [];
export var PLANS = [];
export var ALL_MAJORS = [];

var activeStore = null;
var activeIndex = null;
var activeMetadata = null;
var ready = false;

export function isReady() { return ready; }
export function getMetadata() { return activeMetadata; }

/* 新页面按需加载入口；保留 loadAll 供现有页面迁移期间使用。 */
export function createLazyStore(metadata, fetchImpl) {
  return createDataRepository(metadata, fetchImpl);
}

function normName(value) { return normalizeMajorName(value); }

async function readJson(path, fetcher, cache) {
  if (!cache[path]) {
    cache[path] = (async function () {
      var response;
      try { response = await fetcher(path, { cache: 'no-store' }); }
      catch (error) { throw new Error(path + ' 加载失败：' + error.message); }
      if (!response.ok) throw new Error(path + ' 加载失败（HTTP ' + response.status + '）');
      try { return await response.json(); }
      catch (error) { throw new Error(path + ' 解析失败：' + error.message); }
    })();
  }
  return cache[path];
}

export async function loadAll(metadata, fetchImpl, repository) {
  var fetcher = fetchImpl || fetch;
  var cache = {};
  var store = {
    metadata: metadata,
    years: getSelectableYears(metadata),
    queryIndexByYear: {}, mappingByYear: {}, scoresByYear: {}, plansByYear: {}, fallbacksByYear: {}, mapping: []
  };
  var defaultYear = metadata.defaultYear;
  store.queryIndexByYear[defaultYear] = repository
    ? await repository.ensureQueryIndex(defaultYear)
    : await readJson(metadata.queryMappingSource || metadata.yearSources[defaultYear].queryIndexSource || metadata.yearSources[defaultYear].mappingSource, fetcher, cache);
  store.mapping = store.queryIndexByYear[defaultYear] || [];
  activeStore = store;
  activeMetadata = metadata;
  YEARS = store.years.slice();
  SCORE_BY_YEAR = store.scoresByYear;
  MAPPING = store.mapping;
  PLANS = [];
  ready = true;
  return store;
}

export async function loadYears(store, years, fetchImpl) {
  var fetcher = fetchImpl || fetch;
  var cache = {};
  await Promise.all(years.map(async function (year) {
    if (store.plansByYear[year] && store.scoresByYear[year]) return;
    var source = store.metadata.yearSources[year] || {};
    var catalog = store.metadata.sourceCatalog || {};
    var mappingPath = source.mappingSource || catalog.mapping && catalog.mapping[year];
    var scorePath = source.scoreSource || catalog.scorelines && catalog.scorelines[year];
    var planPath = source.planSource || catalog.plans && catalog.plans[year];
    var collegePath = source.collegeFallbackSource || catalog.colleges && catalog.colleges[year];
    var values = await Promise.all([
      store.queryIndexByYear[year] &&
      (source.queryIndexSource || mappingPath) === mappingPath
        ? Promise.resolve(store.queryIndexByYear[year]) : mappingPath ? readJson(mappingPath, fetcher, cache) : Promise.resolve([]),
      scorePath ? readJson(scorePath, fetcher, cache) : Promise.resolve([]),
      planPath ? readJson(planPath, fetcher, cache) : Promise.resolve([]),
      collegePath ? readJson(collegePath, fetcher, cache) : Promise.resolve([])
    ]);
    store.mappingByYear[year] = values[0];
    store.scoresByYear[year] = values[1];
    store.plansByYear[year] = values[2];
    store.fallbacksByYear[year] = values[3].map(function (row) {
      return normalizeCollegeMasterRow(row, Boolean(planPath));
    });
  }));
  PLANS = store.plansByYear[store.metadata.defaultYear] || [];
  return store;
}

export function normalizedPlansForYears(store, years) {
  var output = {};
  (years || []).forEach(function (year) {
    output[year] = (store.plansByYear[year] || []).map(normalizePlanEntry);
  });
  return output;
}

function createRowIndex(rows) {
  var byName = {}, byCode = {};
  rows.forEach(function (row) {
    var name = normName(row['专业名称']);
    var code = String(row['专业代号'] || row['专业代码'] || '').trim();
    if (name) (byName[name] = byName[name] || []).push(row);
    if (code) (byCode[code] = byCode[code] || []).push(row);
  });
  return { byName: byName, byCode: byCode, all: rows };
}

function createFallbackIndex(rows) {
  var byName = {}, byCode = {};
  rows.forEach(function (row) {
    var name = normName(row['专业名称']);
    var code = normCode6(row['专业代码']);
    if (name) (byName[name] = byName[name] || []).push(row);
    if (code) (byCode[code] = byCode[code] || []).push(row);
  });
  return { byName: byName, byCode: byCode, all: rows };
}

export function buildIndexes(store, metadata) {
  var sourceStore = store || activeStore;
  var sourceMetadata = metadata || activeMetadata;
  if (!sourceStore || !sourceMetadata) throw new Error('数据尚未加载');
  var index = { metadata: sourceMetadata, store: sourceStore, scoreByYear: {}, planByYear: {}, fallbackByYear: {} };
  sourceStore.years.forEach(function (year) {
    var scoreByCode = {};
    (sourceStore.scoresByYear[year] || []).forEach(function (row) {
      var code = String(row['专业代号'] || '').trim();
      if (code) scoreByCode[code] = { name: row['专业名称'], score: row['分数线'] };
    });
    index.scoreByYear[year] = scoreByCode;
    index.planByYear[year] = createRowIndex(sourceStore.plansByYear[year] || []);
    index.fallbackByYear[year] = createFallbackIndex(sourceStore.fallbacksByYear[year] || []);
  });
  activeIndex = index;
  return index;
}

export function getMappingByYear(year) {
  return activeStore && (activeStore.queryIndexByYear[year] || activeStore.mappingByYear[year]) || [];
}

export function getPlansByYear(year) {
  return activeStore && activeStore.plansByYear[year] ? activeStore.plansByYear[year] : [];
}

export function getScoreIndex() {
  return activeIndex ? activeIndex.scoreByYear : {};
}

export function getScore(indexOrMajor, majorOrYear, maybeYear) {
  var hasIndex = indexOrMajor && indexOrMajor.scoreByYear;
  var index = hasIndex ? indexOrMajor : activeIndex;
  var major = hasIndex ? majorOrYear : indexOrMajor;
  var year = hasIndex ? maybeYear : majorOrYear;
  var db = index && index.scoreByYear[year];
  if (!db) return null;
  var code = String(major['专业代号'] || '').trim();
  var name = String(major['专业名称'] || '').trim();
  if (code && db[code]) return db[code].score;
  if (name) {
    for (var key in db) if (db[key].name === name) return db[key].score;
  }
  return null;
}

export function getCollegesByYear(indexOrYear, yearOrMajor, maybeMajor) {
  var hasIndex = indexOrYear && indexOrYear.planByYear;
  var index = hasIndex ? indexOrYear : activeIndex;
  var year = hasIndex ? yearOrMajor : indexOrYear;
  var major = hasIndex ? maybeMajor : yearOrMajor;
  if (!index) return [];
  var planIndex = index.planByYear[year] || { byName: {}, byCode: {} };
  var fallbackIndex = index.fallbackByYear[year] || { byName: {}, byCode: {} };
  var name = normName(major['专业名称']);
  var code = String(major['专业代号'] || '').trim();
  var code6 = normCode6(major['代码6位'] || '');
  var list = selectMajorRows(planIndex.all || [], code, name,
    function (row) { return row['专业代号'] || row['专业代码']; },
    function (row) { return row['专业名称']; });
  if (!list.length) list = null;
  if (!list) list = code6 ? fallbackIndex.byCode[code6] : name && fallbackIndex.byName[name];
  if (!list) return [];
  return list.slice().sort(function (a, b) {
    var order = { '公办': 0, '民办': 1 };
    var aType = a['办学性质'] || '未标注', bType = b['办学性质'] || '未标注';
    if (aType !== bType) return (order[aType] ?? 2) - (order[bType] ?? 2);
    var aName = schoolName(a), bName = schoolName(b);
    if (aName !== bName) return aName.localeCompare(bName, 'zh-CN');
    return String(a['院校代号'] || '').localeCompare(String(b['院校代号'] || ''));
  });
}

export function getMasterRowsByYear(indexOrYear, yearOrMajor, maybeMajor) {
  var hasIndex = indexOrYear && indexOrYear.fallbackByYear;
  var index = hasIndex ? indexOrYear : activeIndex;
  var year = hasIndex ? yearOrMajor : indexOrYear;
  var major = hasIndex ? maybeMajor : yearOrMajor;
  var source = index && index.fallbackByYear[year];
  if (!source || !major) return [];
  var code6 = normCode6(major['代码6位'] || major.disciplineCode6 || '');
  return (code6 ? source.byCode[code6] : source.byName[normName(major['专业名称'] || major.majorName)]) || [];
}

export function getPlanStats(year) {
  var schools = {}, privateRows = 0, povertyRows = 0, regularRows = 0, total = 0;
  var rows = year == null ? PLANS : getPlansByYear(year);
  rows.forEach(function (row) {
    schools[schoolName(row)] = true;
    if (row['办学性质'] === '民办') privateRows += 1;
    if (row['建档立卡'] === '是') povertyRows += 1;
    if (row['招生类别'] === '普通专升本') regularRows += 1;
    total += Number(row['计划人数']) || 0;
  });
  return { 条数: rows.length, 院校数: Object.keys(schools).length, 民办条目: privateRows, 建档立卡专项: povertyRows, 普通计划: regularRows, 计划人数合计: total };
}

export function uniqueMajors() {
  var seen = {}, output = [];
  MAPPING.forEach(function (mapping) {
    (mapping['可报本科专业'] || []).forEach(function (major) {
      if (!seen[major['专业名称']]) { seen[major['专业名称']] = true; output.push(major); }
    });
  });
  ALL_MAJORS = output;
  return output;
}
