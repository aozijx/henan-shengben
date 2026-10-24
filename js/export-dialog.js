import { esc } from './utils.js';
import { getExportFields } from './export.js';

function fieldYear(field, years) {
  return (years || []).find(function (year) { return String(field.key).endsWith(String(year)); });
}

function fieldGroups(fields, years) {
  var base = [];
  var byYear = new Map();
  (years || []).forEach(function (year) { byYear.set(year, []); });
  fields.forEach(function (field) {
    var year = fieldYear(field, years);
    if (year == null) base.push(field);
    else byYear.get(year).push(field);
  });
  var groups = [];
  if (base.length) groups.push({ label: '专业信息', fields: base });
  byYear.forEach(function (yearFields, year) {
    if (yearFields.length) groups.push({ label: year + ' 年', fields: yearFields });
  });
  return groups;
}

function fieldOptionsHtml(fields, selectedKeys) {
  return fields.map(function (field) {
    var checked = selectedKeys.has(field.key) ? ' checked' : '';
    return '<label class="export-field-option"><input type="checkbox" name="export-field" value="' + esc(field.key) + '"' + checked + '><span>' +
      esc(field.exportLabel || field.label || field.key) + '</span></label>';
  }).join('');
}

function renderFieldOptions(list, fields, years, selectedKeys) {
  list.innerHTML = fieldGroups(fields, years).map(function (group) {
    return '<fieldset class="export-field-group"><legend>' + esc(group.label) + '</legend>' +
      fieldOptionsHtml(group.fields, selectedKeys) + '</fieldset>';
  }).join('');
}

function checkedKeys(dialog) {
  return Array.from(dialog.querySelectorAll('input[name="export-field"]:checked'))
    .map(function (input) { return input.value; });
}

function setAll(dialog, checked) {
  dialog.querySelectorAll('input[name="export-field"]').forEach(function (input) { input.checked = checked; });
}

export function bindExportDialog(dialog, trigger, metadata, getState, onExport) {
  if (!dialog || !trigger) return;
  var list = dialog.querySelector('#export-field-list');
  var error = dialog.querySelector('#export-fields-error');
  var rememberedKeys = null;

  trigger.addEventListener('click', function () {
    var state = getState();
    var years = state.selectedYears || [];
    var fields = getExportFields(metadata, years);
    if (!fields.length) {
      error.textContent = '当前没有可导出的字段。';
      return;
    }
    var available = new Set(fields.map(function (field) { return field.key; }));
    var selected = rememberedKeys == null
      ? available
      : new Set(rememberedKeys.filter(function (key) { return available.has(key); }));
    renderFieldOptions(list, fields, years, selected);
    error.textContent = '';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });

  var selectAll = dialog.querySelector('[data-export-select-all]');
  if (selectAll) selectAll.addEventListener('click', function () { setAll(dialog, true); error.textContent = ''; });
  var clearAll = dialog.querySelector('[data-export-clear-all]');
  if (clearAll) clearAll.addEventListener('click', function () { setAll(dialog, false); error.textContent = ''; });
  var confirm = dialog.querySelector('[data-export-confirm]');
  if (confirm) confirm.addEventListener('click', function () {
    var selected = checkedKeys(dialog);
    if (!selected.length) {
      error.textContent = '请至少选择一个导出字段。';
      return;
    }
    rememberedKeys = selected;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    onExport(selected);
  });
}
