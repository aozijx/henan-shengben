/* metadata 驱动的结果区字段可见性；筛选条件只影响展示，不改写业务原始数据。 */
export function hiddenResultFields(metadata, filters) {
  var hidden = new Set();
  var rules = metadata && Array.isArray(metadata.resultVisibilityRules) ? metadata.resultVisibilityRules : [];
  rules.forEach(function (rule) {
    var condition = rule && rule.when;
    if (!condition || !condition.filterKey) return;
    if ((filters || {})[condition.filterKey] !== condition.equals) return;
    (rule.hide || []).forEach(function (key) { hidden.add(key); });
  });
  return hidden;
}

export function resultFieldVisible(hiddenFields, key) {
  return !hiddenFields || !hiddenFields.has(key);
}
