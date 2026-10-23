import { formatFieldValue } from './preview.js';

function isSelectedYearField(field, metadata, selectedYears) {
  var supportedYears = metadata.supportedYears || [];
  var fieldYear = supportedYears.find(function (year) { return String(field.key).endsWith(String(year)); });
  return fieldYear == null || !Array.isArray(selectedYears) || selectedYears.indexOf(fieldYear) >= 0;
}

export function getExportFields(metadata, selectedYears) {
  return (metadata.fields || []).filter(function (field) {
    return field.exportEnable && isSelectedYearField(field, metadata, selectedYears);
  });
}

function csvCell(value) {
  var text = String(value == null ? '' : value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function serializeCsv(rows, fields) {
  var header = fields.map(function (field) { return csvCell(field.exportLabel); }).join(',');
  var lines = rows.map(function (row) {
    return fields.map(function (field) { return csvCell(formatFieldValue(row, field)); }).join(',');
  });
  return '\uFEFF' + [header].concat(lines).join('\r\n');
}

function pad2(value) { return String(value).padStart(2, '0'); }

export function buildExportFilename(year, date) {
  var clock = date || new Date();
  var stamp = String(clock.getFullYear()) + pad2(clock.getMonth() + 1) + pad2(clock.getDate());
  return '院校数据_' + year + '_' + stamp + '.csv';
}

export function prepareExport(previewModel, metadata, focusYear) {
  if (!previewModel || previewModel.status !== 'ready') throw new Error('预览尚未就绪，不可导出');
  if (!Array.isArray(previewModel.allRows) || !previewModel.allRows.length) throw new Error('没有可导出的预览数据');
  return {
    rows: previewModel.allRows,
    fields: getExportFields(metadata, previewModel.selectedYears),
    year: focusYear
  };
}

export function downloadCsv(model, documentLike, urlApi) {
  if (!model.rows || !model.rows.length) throw new Error('没有可导出的预览数据');
  var doc = documentLike || document;
  var urls = urlApi || URL;
  var filename = buildExportFilename(model.year, model.date);
  var blob = new Blob([serializeCsv(model.rows, model.fields)], { type: 'text/csv;charset=utf-8' });
  var objectUrl = urls.createObjectURL(blob);
  var anchor = doc.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  doc.body.appendChild(anchor);
  try { anchor.click(); }
  finally {
    anchor.remove();
    urls.revokeObjectURL(objectUrl);
  }
  return filename;
}
