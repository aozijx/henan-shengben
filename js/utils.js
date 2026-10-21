/* ============================================================
   河南专升本 · 查询工具  —  基础工具
   ============================================================ */

/* HTML 转义 */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* 专业代码去掉 T / K 后缀，取 6 位数字部分 */
export function normCode6(s) {
  return String(s || '').replace(/[A-Z]+$/, '');
}
