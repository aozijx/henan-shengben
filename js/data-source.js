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
      cache.set(url, (async function () {
        var response;
        try { response = await fetcher(url, { cache: 'no-store' }); }
        catch (error) { throw new Error(url + ' 加载失败：' + error.message); }
        if (!response.ok) throw new Error(url + ' 加载失败（HTTP ' + response.status + '）');
        try { return await response.json(); }
        catch (error) { throw new Error(url + ' 解析失败：' + error.message); }
      })());
    }
    return cache.get(url);
  }

  return {
    ensureQueryIndex: function (year) {
      var source = metadata.yearSources[year];
      return load(source.queryIndexSource || source.mappingSource);
    },
    ensureMapping: function (year) { return load(sourceFor(metadata, year, 'mappingSource')); },
    ensureScores: function (year) { return load(sourceFor(metadata, year, 'scoreSource')); },
    ensurePlans: function (year) { return load(sourceFor(metadata, year, 'planSource')); },
    ensureScoreSegments: function (year) { return load(sourceFor(metadata, year, 'scoreSegmentSource')); },
    ensureFallbacks: function (year) {
      var source = metadata.yearSources[year];
      return source.collegeFallbackSource ? load(source.collegeFallbackSource) : Promise.resolve([]);
    },
    retry: function (url) { cache.delete(url); return load(url); },
    clear: function () { cache.clear(); }
  };
}
