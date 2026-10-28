export function defaultCollegeYear(years) {
  var available = (years || []).filter(Number.isInteger);
  return available.length ? String(Math.max(...available)) : 'all';
}
