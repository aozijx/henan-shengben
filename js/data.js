/* 数据加载、索引与读取。数据源和年份完全由 metadata 声明。 */
import { normCode6 } from './utils.js';

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

function normName(value) { return String(value || '').replace(/\s+/g, ''); }

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

export async function loadAll(metadata, fetchImpl) {
  var fetcher = fetchImpl || fetch;
  var cache = {};
  var store = {
    metadata: metadata,
    years: metadata.supportedYears.slice(),
    mappingByYear: {}, scoresByYear: {}, plansByYear: {}, fallbacksByYear: {}, mapping: []
  };
  await Promise.all(store.years.map(async function (year) {
    var source = metadata.yearSources[year];
    var values = await Promise.all([
      readJson(source.mappingSource, fetcher, cache),
      readJson(source.scoreSource, fetcher, cache),
      readJson(source.planSource, fetcher, cache),
      source.collegeFallbackSource ? readJson(source.collegeFallbackSource, fetcher, cache) : Promise.resolve([])
    ]);
    store.mappingByYear[year] = values[0];
    store.scoresByYear[year] = values[1];
    store.plansByYear[year] = values[2];
    store.fallbacksByYear[year] = values[3];
  }));
  store.mapping = store.mappingByYear[metadata.defaultYear] || [];
  activeStore = store;
  activeMetadata = metadata;
  YEARS = store.years.slice();
  SCORE_BY_YEAR = store.scoresByYear;
  MAPPING = store.mapping;
  PLANS = store.plansByYear[metadata.defaultYear] || [];
  ready = true;
  return store;
}

function createRowIndex(rows) {
  var byName = {}, byCode = {};
  rows.forEach(function (row) {
    var name = normName(row['专业名称']);
    var code = String(row['专业代号'] || row['专业代码'] || '').trim();
    if (name) (byName[name] = byName[name] || []).push(row);
    if (code) (byCode[code] = byCode[code] || []).push(row);
  });
  return { byName: byName, byCode: byCode };
}

function createFallbackIndex(rows) {
  var byName = {}, byCode = {};
  rows.forEach(function (row) {
    var name = normName(row['专业名称']);
    var code = normCode6(row['专业代码']);
    if (name) (byName[name] = byName[name] || []).push(row);
    if (code) (byCode[code] = byCode[code] || []).push(row);
  });
  return { byName: byName, byCode: byCode };
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
  return activeStore && activeStore.mappingByYear[year] ? activeStore.mappingByYear[year] : [];
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
    for (var fallbackKey in db) if (db[fallbackKey].name && db[fallbackKey].name.indexOf(name) > -1) return db[fallbackKey].score;
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
  var list = name && planIndex.byName[name];
  if (!list && code) {
    var alias = code === '99' ? 'A1' : (code === 'A1' ? '99' : code);
    list = planIndex.byCode[code] || planIndex.byCode[alias];
  }
  if (!list) list = (code6 && fallbackIndex.byCode[code6]) || (name && fallbackIndex.byName[name]);
  if (!list) return [];
  return list.slice().sort(function (a, b) {
    var aType = a['办学性质'] || '公办', bType = b['办学性质'] || '公办';
    if (aType !== bType) return aType === '公办' ? -1 : 1;
    var aName = a['院校名称'] || a['学校名称'] || '', bName = b['院校名称'] || b['学校名称'] || '';
    if (aName !== bName) return aName.localeCompare(bName, 'zh-CN');
    return String(a['院校代号'] || '').localeCompare(String(b['院校代号'] || ''));
  });
}

export function getPlanStats() {
  var schools = {}, privateRows = 0, povertyRows = 0, regularRows = 0, total = 0;
  PLANS.forEach(function (row) {
    schools[row['院校名称']] = true;
    if (row['办学性质'] === '民办') privateRows += 1;
    if (row['建档立卡'] === '是') povertyRows += 1;
    if (row['招生类别'] === '普通专升本') regularRows += 1;
    total += Number(row['计划人数']) || 0;
  });
  return { 条数: PLANS.length, 院校数: Object.keys(schools).length, 民办条目: privateRows, 建档立卡专项: povertyRows, 普通计划: regularRows, 计划人数合计: total };
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
