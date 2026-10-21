import { esc } from './utils.js';

export function getPreviewFields(metadata) {
  return (metadata.fields || []).filter(function (field) { return field.tableShow; });
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

export function buildPreviewHtml(model, metadata) {
  if (model.status === 'loading') return '<div class="preview-state loading">正在生成预览…</div>';
  if (model.status === 'error') return '<div class="preview-state msg-notfound">' + esc(model.error || '数据加载失败') + '</div>';
  if (!model.hasSearch) return '<div class="preview-state empty">请先查询专科专业，再使用筛选与导出。</div>';
  if (!model.rows.length) return '<div class="preview-state empty">筛选后没有匹配数据，请调整条件或重置筛选。</div>';

  var fields = getPreviewFields(metadata);
  var page = paginate(model.rows, model.page, metadata.pageSize);
  var headers = fields.map(function (field) {
    return '<th scope="col" data-field="' + esc(field.key) + '">' + esc(field.label) + '</th>';
  }).join('');
  var body = page.rows.map(function (row) {
    return '<tr>' + fields.map(function (field) {
      return '<td data-field="' + esc(field.key) + '">' + esc(formatFieldValue(row, field)) + '</td>';
    }).join('') + '</tr>';
  }).join('');

  return '<div class="preview-summary"><b>导出预览</b><span>有效院校 ' + Number(model.effectiveSchoolCount || 0) +
    ' 所 · 共 ' + page.total + ' 个专业 · 当前 ' + page.start + '–' + page.end + '</span></div>' +
    '<div class="preview-scroll"><table class="preview-table"><thead><tr>' + headers + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
    '<nav class="preview-pagination" aria-label="预览分页">' +
      '<button type="button" data-page="' + (page.page - 1) + '"' + (page.page <= 1 ? ' disabled' : '') + '>上一页</button>' +
      '<span>第 ' + page.page + ' / ' + page.pageCount + ' 页</span>' +
      '<button type="button" data-page="' + (page.page + 1) + '"' + (page.page >= page.pageCount ? ' disabled' : '') + '>下一页</button>' +
    '</nav>';
}

export function renderPreview(root, model, metadata, dispatch) {
  if (!root) return;
  root.innerHTML = buildPreviewHtml(model, metadata);
  root.querySelectorAll('[data-page]').forEach(function (button) {
    button.addEventListener('click', function () {
      dispatch({ type: 'SET_PAGE', page: Number(button.dataset.page) });
    });
  });
}
