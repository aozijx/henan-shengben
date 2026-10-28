import { formatFieldValue } from './table-utils.js';
import { getSelectableYears } from './metadata.js';

function isSelectedYearField(field, metadata, selectedYears) {
  var supportedYears = getSelectableYears(metadata);
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

export function prepareExport(resultModel, metadata, focusYear, selectedFieldKeys) {
  if (!resultModel || resultModel.status !== 'ready') throw new Error('查询结果尚未就绪，不可导出');
  if (!Array.isArray(resultModel.allRows) || !resultModel.allRows.length) throw new Error('当前没有可导出的筛选结果');
  var fields = getExportFields(metadata, resultModel.selectedYears);
  if (Array.isArray(selectedFieldKeys)) {
    var selected = new Set(selectedFieldKeys);
    fields = fields.filter(function (field) { return selected.has(field.key); });
    if (!fields.length) throw new Error('请至少选择一个导出字段');
  }
  return {
    rows: resultModel.allRows,
    fields: fields,
    year: focusYear
  };
}

export function downloadCsv(model, documentLike, urlApi) {
  if (!model.rows || !model.rows.length) throw new Error('当前没有可导出的筛选结果');
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
