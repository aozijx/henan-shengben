/* Per-application data context and lookup indexes. Network access lives in data-source.js. */
import { normCode6, schoolName } from './utils.js';
import { normalizeCollegeMasterRow } from './model.js';
import { normalizeMajorName, selectMajorRows } from './major-match.js';

function normName(value) { return normalizeMajorName(value); }

function createFallbackIndex(rows) {
  var byName = {}, byCode = {};
  (rows || []).forEach(function (row) {
    var name = normName(row['专业名称']);
    var code = normCode6(row['专业代码']);
    if (name) (byName[name] = byName[name] || []).push(row);
    if (code) (byCode[code] = byCode[code] || []).push(row);
  });
  return { byName: byName, byCode: byCode };
}

function createYearIndex(year, source, normalizeFallbacks) {
  var scoreByCode = {};
  (source.scores || []).forEach(function (row) {
    var code = String(row['专业代号'] || '').trim();
    if (code) scoreByCode[code] = { name: row['专业名称'], score: row['分数线'] };
  });
  var fallbacks = source.colleges || source.fallbacks || [];
  if (normalizeFallbacks) {
    fallbacks = fallbacks.map(function (row) {
      return normalizeCollegeMasterRow(row, Boolean(source.planPublished));
    });
  }
  return {
    year: year,
    scoreByCode: scoreByCode,
    planRows: source.plans || [],
    fallbackByCode: createFallbackIndex(fallbacks)
  };
}

function scoreFrom(index, major) {
  if (!index || !major) return null;
  var code = String(major['专业代号'] || '').trim();
  var name = String(major['专业名称'] || '').trim();
  if (code && index.scoreByCode[code]) return index.scoreByCode[code].score;
  if (name) {
    for (var key in index.scoreByCode) {
      if (index.scoreByCode[key].name === name) return index.scoreByCode[key].score;
    }
  }
  return null;
}

function collegesFrom(index, major) {
  if (!index || !major) return [];
  var name = normName(major['专业名称'] || major.majorName);
  var code = String(major['专业代号'] || major.majorCode || '').trim();
  var code6 = normCode6(major['代码6位'] || major.disciplineCode6 || '');
  var rows = selectMajorRows(index.planRows, code, name,
    function (row) { return row['专业代号'] || row['专业代码']; },
    function (row) { return row['专业名称']; });
  if (!rows.length) rows = code6 ? index.fallbackByCode.byCode[code6] : index.fallbackByCode.byName[name];
  if (!rows) return [];
  return rows.slice().sort(function (a, b) {
    var order = { '公办': 0, '民办': 1 };
    var aType = a['办学性质'] || '未标注', bType = b['办学性质'] || '未标注';
    if (aType !== bType) return (order[aType] ?? 2) - (order[bType] ?? 2);
    var aName = schoolName(a), bName = schoolName(b);
    if (aName !== bName) return aName.localeCompare(bName, 'zh-CN');
    return String(a['院校代号'] || '').localeCompare(String(b['院校代号'] || ''));
  });
}

function mastersFrom(index, major) {
  if (!index || !major) return [];
  var code6 = normCode6(major['代码6位'] || major.disciplineCode6 || '');
  var name = normName(major['专业名称'] || major.majorName);
  return (code6 ? index.fallbackByCode.byCode[code6] : index.fallbackByCode.byName[name]) || [];
}

export function createDataContext(repository) {
  if (!repository) throw new Error('数据上下文需要 repository');
  var mappings = new Map();
  var mappingRequests = new Map();
  var years = new Map();
  var yearIndexes = new Map();
  var yearRequests = new Map();

  function rememberRequest(requests, key, factory, cache) {
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (requests.has(key)) return requests.get(key);
    var request = Promise.resolve().then(factory).then(function (value) {
      cache.set(key, value);
      requests.delete(key);
      return value;
    }, function (error) {
      requests.delete(key);
      throw error;
    });
    requests.set(key, request);
    return request;
  }

  function ensureQueryIndex(year) {
    return rememberRequest(mappingRequests, year, function () {
      return repository.ensureQueryIndex(year);
    }, mappings);
  }

  function ensureYear(year) {
    return rememberRequest(yearRequests, year, function () {
      return repository.ensureCollegeYear(year).then(function (source) {
        yearIndexes.set(year, createYearIndex(year, source, true));
        return source;
      });
    }, years);
  }

  function setSummaryStore(store) {
    if (!store || !Array.isArray(store.years)) throw new Error('查询摘要缺少年份列表');
    store.years.forEach(function (year) {
      yearIndexes.set(year, createYearIndex(year, {
        scores: store.scoresByYear && store.scoresByYear[year],
        plans: store.plansByYear && store.plansByYear[year],
        fallbacks: store.fallbacksByYear && store.fallbacksByYear[year]
      }, false));
    });
  }

  function getMapping(year) { return mappings.get(year) || []; }

  function uniqueMajors(year) {
    var seen = new Set();
    var output = [];
    getMapping(year).forEach(function (mapping) {
      (mapping['可报本科专业'] || []).forEach(function (major) {
        if (!seen.has(major['专业名称'])) {
          seen.add(major['专业名称']);
          output.push(major);
        }
      });
    });
    return output;
  }

  return {
    ensureQueryIndex: ensureQueryIndex,
    ensureYear: ensureYear,
    setSummaryStore: setSummaryStore,
    hasQueryIndex: function (year) { return mappings.has(year); },
    getMapping: getMapping,
    getScore: function (major, year) { return scoreFrom(yearIndexes.get(year), major); },
    getColleges: function (major, year) { return collegesFrom(yearIndexes.get(year), major); },
    getMasterRows: function (major, year) { return mastersFrom(yearIndexes.get(year), major); },
    uniqueMajors: uniqueMajors
  };
}
