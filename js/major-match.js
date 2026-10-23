export function normalizeMajorName(value) {
  return String(value == null ? '' : value).replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')')
    .replace(/\(本科层次职业教育专业\)$/, '');
}

export function selectMajorRows(rows, majorCode, majorName, getCode, getName) {
  var code = String(majorCode == null ? '' : majorCode).trim();
  var name = normalizeMajorName(majorName);
  var exact = name ? rows.filter(function (row) { return normalizeMajorName(getName(row)) === name; }) : [];
  if (exact.length) {
    var sameCode = exact.filter(function (row) { return String(getCode(row) || '').trim() === code; });
    return sameCode.length ? sameCode : exact;
  }
  var codes = code === '99' ? ['99', 'A1'] : code === 'A1' ? ['A1', '99'] : [code];
  for (var i = 0; i < codes.length; i += 1) {
    var candidates = rows.filter(function (row) { return String(getCode(row) || '').trim() === codes[i]; });
    if (candidates.length && new Set(candidates.map(function (row) { return normalizeMajorName(getName(row)); })).size === 1) {
      return candidates;
    }
  }
  return [];
}
