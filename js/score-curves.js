export function lookupScoreSegmentCode(index, majorCode) {
  var code = String(majorCode || '');
  var aliases = code === '99' ? ['99', 'A1'] : code === 'A1' ? ['A1', '99'] : [code];
  var available = new Set((index && index.majors || [])
    .filter(function (major) { return major.status == null || major.status === 'ok'; })
    .map(function (major) { return major.majorCode; }));
  return aliases.find(function (candidate) { return available.has(candidate); }) || null;
}

export function buildCurve(shard, mode) {
  var rows = shard && Array.isArray(shard.segments) ? shard.segments : [];
  if (!rows.length) return [];
  var total = rows[rows.length - 1].cumulativeCount || 0;
  var previousCount = 0;
  return rows.map(function (row) {
    if (mode === 'rank') return [row.cumulativeCount, row.score];
    var cumulative = Number(row.cumulativeCount);
    var segmentCount = row.segmentCount;
    if (segmentCount == null && Number.isFinite(cumulative)) segmentCount = cumulative - previousCount;
    if (Number.isFinite(cumulative)) previousCount = cumulative;
    if (mode === 'segment') return [row.score, segmentCount];
    if (mode === 'percent') return [row.score, total ? Math.round(row.cumulativeCount / total * 10000) / 100 : null];
    return [row.score, row.cumulativeCount];
  });
}
