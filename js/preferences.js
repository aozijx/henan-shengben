import { enumOptions, filterDefaultValue } from './metadata.js';

export var COLUMN_WIDTHS_KEY = 'henan-table-widths-v1';
export var EXPLORER_STATE_KEY = 'henan-explorer-v1';

function defaultWidth(field) {
  return field.type === 'number' ? 120 : 180;
}

function validWidth(value) {
  return Number.isFinite(value) && value >= 80 && value <= 600;
}

export function readColumnWidths(storage, metadata) {
  var fields = (metadata.fields || []).filter(function (field) { return field.tableShow; });
  var saved = {};
  try {
    var raw = storage.getItem(COLUMN_WIDTHS_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (error) { saved = {}; }
  var widths = {};
  fields.forEach(function (field) {
    widths[field.key] = validWidth(saved[field.key]) ? saved[field.key] : defaultWidth(field);
  });
  return widths;
}

export function writeColumnWidths(storage, widths) {
  var safe = {};
  Object.keys(widths || {}).forEach(function (key) {
    if (validWidth(widths[key])) safe[key] = widths[key];
  });
  storage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(safe));
}

/* ---------- 筛选与排序状态持久化 ---------- */

function filterFields(metadata) {
  return (metadata.fields || []).filter(function (field) { return field.filterEnable; });
}

function sanitizeFilters(saved, metadata) {
  var filters = {};
  filterFields(metadata).forEach(function (field) {
    var value = saved[field.key];
    if (field.type === 'enum') {
      filters[field.key] = enumOptions(field).indexOf(value) >= 0 ? value : filterDefaultValue(field);
    } else if (field.type === 'number') {
      filters[field.key] = /^\d*$/.test(String(value == null ? '' : value)) ? String(value) : '';
    } else {
      filters[field.key] = value == null ? filterDefaultValue(field) : String(value);
    }
  });
  return filters;
}

function sanitizeSort(saved, metadata) {
  var sortable = (metadata.fields || [])
    .filter(function (field) { return field.sortEnable; })
    .map(function (field) { return field.key; });
  var key = saved && saved.key;
  var direction = saved && saved.direction;
  if (sortable.indexOf(key) < 0) {
    return { key: metadata.defaultSort.key, direction: metadata.defaultSort.direction };
  }
  var validDirections = ['asc', 'desc'];
  if (key === 'originalOrder') validDirections.push('original');
  if (validDirections.indexOf(direction) < 0) direction = metadata.defaultSort.direction;
  return { key: key, direction: direction };
}

export function readExplorerState(storage, metadata) {
  var saved = {};
  try {
    var raw = storage.getItem(EXPLORER_STATE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (error) { saved = {}; }
  return {
    filters: sanitizeFilters(saved.filters || {}, metadata),
    sort: sanitizeSort(saved.sort || {}, metadata)
  };
}

export function writeExplorerState(storage, filters, sort) {
  storage.setItem(EXPLORER_STATE_KEY, JSON.stringify({ filters: filters, sort: sort }));
}

export function clearPreferences(storage) {
  storage.clear();
}
