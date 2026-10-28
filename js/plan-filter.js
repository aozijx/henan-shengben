export function excludesPovertyPlans(filters) {
  return Boolean(filters && filters.povertyStatus === '否');
}

export function matchesSchoolType(type, filters) {
  var selected = filters && filters.schoolType;
  return !selected || selected === '全部' || selected === type;
}

export function isPovertyPlan(entry) {
  return Boolean(entry && (entry.povertyStatus === '是' || entry['建档立卡'] === '是' ||
    /建档立卡/.test(String(entry.admissionCategory || entry['招生类别'] || ''))));
}
