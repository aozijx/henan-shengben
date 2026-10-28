import { esc } from './utils.js';

export function formatFieldValue(row, field) {
  var value = row[field.key];
  if (value == null || value === '') return '—';
  if (field.type === 'number') return String(Number(value));
  if (field.type === 'boolean') return value ? '是' : '否';
  return String(value);
}

export function paginate(rows, requestedPage, pageSize) {
  var size = Math.max(1, Number(pageSize) || 1);
  var total = rows.length;
  var pageCount = Math.max(1, Math.ceil(total / size));
  var page = Math.min(pageCount, Math.max(1, Number(requestedPage) || 1));
  var offset = (page - 1) * size;
  var pageRows = rows.slice(offset, offset + size);
  return { rows: pageRows, page: page, pageCount: pageCount, total: total,
    start: total ? offset + 1 : 0, end: total ? offset + pageRows.length : 0 };
}

export function buildPaginationHtml(currentPage, pageCount, label) {
  return '<nav class="table-pagination" aria-label="' + esc(label || '分页') + '">' +
    '<button type="button" data-page="' + (currentPage - 1) + '"' + (currentPage <= 1 ? ' disabled' : '') + '>上一页</button>' +
    '<span>第 ' + currentPage + ' / ' + pageCount + ' 页</span>' +
    '<button type="button" data-page="' + (currentPage + 1) + '"' + (currentPage >= pageCount ? ' disabled' : '') + '>下一页</button>' +
  '</nav>';
}

export function nextSortDirection(current, key) {
  if (!current || current.key !== key || current.direction === 'asc') return 'desc';
  return 'asc';
}
