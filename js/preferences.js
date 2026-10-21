export var COLUMN_WIDTHS_KEY = 'henan-table-widths-v1';

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

export function clearPreferences(storage) {
  storage.clear();
}
