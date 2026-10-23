import { esc } from './utils.js';
import { buildResultModel } from './result-model.js';

function isSelectedYearField(field, metadata, selectedYears) {
  var years = metadata.supportedYears || [];
  var matchedYear = years.find(function (year) { return String(field.key).endsWith(String(year)); });
  return matchedYear == null || selectedYears.indexOf(matchedYear) >= 0;
}

export function getPreviewFields(metadata, selectedYears) {
  var years = Array.isArray(selectedYears) ? selectedYears : (metadata.supportedYears || []);
  return (metadata.fields || []).filter(function (field) {
    return field.tableShow && isSelectedYearField(field, metadata, years);
  });
}

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
  return {
    rows: pageRows,
    page: page,
    pageCount: pageCount,
    total: total,
    start: total ? offset + 1 : 0,
    end: total ? offset + pageRows.length : 0
  };
}

export function buildPaginationHtml(currentPage, pageCount, label) {
  return '<nav class="preview-pagination" aria-label="' + esc(label || '预览分页') + '">' +
    '<button type="button" data-page="' + (currentPage - 1) + '"' + (currentPage <= 1 ? ' disabled' : '') + '>上一页</button>' +
    '<span>第 ' + currentPage + ' / ' + pageCount + ' 页</span>' +
    '<button type="button" data-page="' + (currentPage + 1) + '"' + (currentPage >= pageCount ? ' disabled' : '') + '>下一页</button>' +
  '</nav>';
}

export function resizeColumnWidth(current, delta) {
  return Math.min(600, Math.max(80, Number(current) + Number(delta)));
}

export function createPreviewModel(aggregates, metadata, state) {
  var result = buildResultModel({
    aggregates: aggregates,
    metadata: metadata,
    selectedYears: state && state.selectedYears,
    filters: state && state.filters,
    sort: state && state.sort
  });
  var fields = getPreviewFields(metadata, result.selectedYears);
  var allRows = result.allRows.map(function (row) {
    return fields.reduce(function (projected, field) {
      projected[field.key] = row[field.key];
      return projected;
    }, {});
  });
  var page = paginate(allRows, state && state.page, metadata.pageSize);
  return {
    status: state && state.status || 'ready',
    hasSearch: state ? state.hasSearch !== false : true,
    allRows: allRows,
    pageRows: page.rows,
    page: page.page,
    pageCount: page.pageCount,
    selectedYears: result.selectedYears,
    focusYear: result.focusYear,
    effectiveSchoolCount: result.effectiveSchoolCount,
    effectiveSchoolYear: result.effectiveSchoolYear,
    fields: fields
  };
}

export function buildPreviewHtml(model, metadata) {
  if (model.status === 'loading') return '<div class="preview-state loading">正在生成预览…</div>';
  if (model.status === 'error') return '<div class="preview-state msg-notfound">' + esc(model.error || '数据加载失败') + '</div>';
  if (!model.hasSearch) return '<div class="preview-state empty">请先查询专科专业，再使用筛选与导出。</div>';
  var allRows = model.allRows || model.rows || [];
  if (!allRows.length) return '<div class="preview-state empty">筛选后没有匹配数据，请调整条件或重置筛选。</div>';

  var fields = model.fields || getPreviewFields(metadata, model.selectedYears);
  var page = paginate(allRows, model.page, metadata.pageSize);
  var widths = model.columnWidths || {};
  var columns = fields.map(function (field) {
    var width = widths[field.key];
    return '<col data-field="' + esc(field.key) + '"' + (width ? ' style="width:' + Number(width) + 'px"' : '') + '>';
  }).join('');
  var headers = fields.map(function (field) {
    /* sortKey：拆分列（如 院校数(公/民)）按其对应的合计数值字段排序 */
    var sortKey = field.sortKey || field.key;
    var sortable = field.sortEnable || field.sortKey;
    var sort = model.sort && model.sort.key === sortKey ? model.sort.direction : null;
    var indicator = sort === 'desc' ? '<span class="sort-ind">▼</span>'
      : sort === 'asc' ? '<span class="sort-ind">▲</span>' : '';
    var ariaSort = sort === 'desc' ? ' aria-sort="descending"'
      : sort === 'asc' ? ' aria-sort="ascending"' : '';
    var sortableAttr = sortable ? ' class="sortable" data-sort="' + esc(sortKey) + '" title="点击排序"' + ariaSort : '';
    return '<th scope="col" data-field="' + esc(field.key) + '"' + sortableAttr + '>' + esc(field.label) + indicator +
      '<button type="button" class="column-resizer" data-resize="' + esc(field.key) + '" aria-label="调整' + esc(field.label) + '列宽"></button></th>';
  }).join('');
  var body = page.rows.map(function (row) {
    return '<tr>' + fields.map(function (field) {
      return '<td data-field="' + esc(field.key) + '">' + esc(formatFieldValue(row, field)) + '</td>';
    }).join('') + '</tr>';
  }).join('');

  var schoolLabel = '有效院校' + (model.effectiveSchoolYear ? '（' + model.effectiveSchoolYear + '）' : '');
  return '<div class="preview-summary"><b>导出预览</b><span>' + esc(schoolLabel) + ' ' + Number(model.effectiveSchoolCount || 0) +
    ' 所 · 共 ' + page.total + ' 个专业 · 当前 ' + page.start + '–' + page.end + '</span></div>' +
    '<div class="preview-scroll"><table class="preview-table"><colgroup>' + columns + '</colgroup><thead><tr>' + headers + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
    buildPaginationHtml(page.page, page.pageCount, '预览分页');
}

export function nextSortDirection(current, key) {
  if (!current || current.key !== key || current.direction === 'asc') return 'desc';
  return 'asc';
}

export function renderPreview(root, model, metadata, dispatch) {
  if (!root) return;
  root.innerHTML = buildPreviewHtml(model, metadata);
  root.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function (event) {
      if (event.target.closest('.column-resizer')) return;
      dispatch({
        type: 'SET_SORT',
        sort: { key: th.dataset.sort, direction: nextSortDirection(model.sort, th.dataset.sort) }
      });
    });
  });
  root.querySelectorAll('[data-page]').forEach(function (button) {
    button.addEventListener('click', function () {
      dispatch({ type: 'SET_PAGE', page: Number(button.dataset.page) });
    });
  });
  root.querySelectorAll('[data-resize]').forEach(function (handle) {
    var key = handle.dataset.resize;
    handle.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      var current = (model.columnWidths && model.columnWidths[key]) || 120;
      dispatch({ type: 'SET_COLUMN_WIDTH', key: key, width: resizeColumnWidth(current, event.key === 'ArrowLeft' ? -10 : 10) });
    });
    handle.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      var startX = event.clientX;
      var startWidth = (model.columnWidths && model.columnWidths[key]) || 120;
      function move(moveEvent) {
        dispatch({ type: 'SET_COLUMN_WIDTH', key: key, width: resizeColumnWidth(startWidth, moveEvent.clientX - startX) });
      }
      function stop() {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', stop);
      }
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', stop, { once: true });
    });
  });
}
