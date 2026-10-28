import { schoolName } from './utils.js';

function masterMarkFields(metadata) {
  return (metadata && metadata.fields || []).filter(function (field) {
    return field.filterEnable && field.sourceRole === 'colleges' && field.sourceColumn;
  });
}

export function hasMasterMarkFilter(filters, metadata) {
  return masterMarkFields(metadata).some(function (field) {
    return filters && filters[field.key] && filters[field.key] !== '全部';
  });
}

export function matchesMasterMarks(row, filters, metadata) {
  return masterMarkFields(metadata).every(function (field) {
    var requested = filters && filters[field.key];
    if (!requested || requested === '全部') return true;
    if (!row || !Object.hasOwn(row, field.sourceColumn)) return false;
    var mark = String(row[field.sourceColumn] || '').trim();
    return requested === '未标注' ? mark === '' : mark === requested;
  });
}

export function masterEvidenceForSchool(masterRows, name, filters, metadata) {
  var exactName = String(name || '').trim();
  return (masterRows || []).some(function (row) {
    return schoolName(row).trim() === exactName && matchesMasterMarks(row, filters, metadata);
  });
}
