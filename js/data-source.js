function sourceFor(metadata, year, key) {
  var source = metadata.yearSources && metadata.yearSources[year];
  if (!source || !source[key]) throw new Error(year + ' 年缺少 ' + key);
  return source[key];
}

export function createDataRepository(metadata, fetchImpl) {
  var fetcher = fetchImpl || fetch;
  var cache = new Map();

  function load(url) {
    if (!cache.has(url)) {
      var request = (async function () {
        var response;
        try { response = await fetcher(url, { cache: 'no-store' }); }
        catch (error) { throw new Error(url + ' 加载失败：' + error.message); }
        if (!response.ok) throw new Error(url + ' 加载失败（HTTP ' + response.status + '）');
        try { return await response.json(); }
        catch (error) { throw new Error(url + ' 解析失败：' + error.message); }
      })();
      cache.set(url, request);
      request.catch(function () { if (cache.get(url) === request) cache.delete(url); });
    }
    return cache.get(url);
  }

  return {
    ensureQueryIndex: function (year) {
      var source = metadata.yearSources && metadata.yearSources[year] || {};
      var path = metadata.queryMappingSource || source.queryIndexSource || source.mappingSource ||
        metadata.sourceCatalog && metadata.sourceCatalog.mapping && metadata.sourceCatalog.mapping[year];
      return path ? load(path) : Promise.reject(new Error(year + ' 年尚无专业对照表'));
    },
    ensureCollegeYear: function (year) {
      var catalog = metadata.sourceCatalog || {};
      var annual = metadata.yearSources && metadata.yearSources[year] || {};
      var planPath = catalog.plans && catalog.plans[year] || annual.planSource;
      var collegePath = catalog.colleges && catalog.colleges[year] || annual.collegeFallbackSource;
      var scorePath = catalog.scorelines && catalog.scorelines[year] || annual.scoreSource;
      return Promise.all([planPath ? load(planPath) : [], collegePath ? load(collegePath) : [],
        scorePath ? load(scorePath) : []])
        .then(function ([plans, colleges, scores]) {
          return { plans: plans, colleges: colleges, scores: scores,
            planPublished: Boolean(planPath), scorePublished: Boolean(scorePath) };
        });
    },
    ensureCollegeMaster: function (year) {
      var catalog = metadata.sourceCatalog || {};
      var annual = metadata.yearSources && metadata.yearSources[year] || {};
      var path = catalog.colleges && catalog.colleges[year] || annual.collegeFallbackSource;
      return path ? load(path) : Promise.resolve([]);
    },
    ensureMapping: function (year) { return load(sourceFor(metadata, year, 'mappingSource')); },
    ensureScores: function (year) { return load(sourceFor(metadata, year, 'scoreSource')); },
    ensurePlans: function (year) { return load(sourceFor(metadata, year, 'planSource')); },
    ensureAnalytics: function (year) { return load(sourceFor(metadata, year, 'analyticsSource')); },
    ensureScoreSegmentIndex: function (year) { return load(sourceFor(metadata, year, 'scoreSegmentIndexSource')); },
    ensureScoreSegment: function (year, majorCode) {
      var code = String(majorCode || '');
      if (!/^[a-zA-Z0-9]+$/.test(code)) return Promise.reject(new Error('专业代号无效'));
      return load(sourceFor(metadata, year, 'scoreSegmentShardTemplate')
        .replace(/\{year\}/g, String(year)).replace(/\{majorCode\}/g, code));
    },
    ensureFallbacks: function (year) {
      var source = metadata.yearSources[year];
      return source.collegeFallbackSource ? load(source.collegeFallbackSource) : Promise.resolve([]);
    },
    retry: function (url) { cache.delete(url); return load(url); },
    clear: function () { cache.clear(); }
  };
}
