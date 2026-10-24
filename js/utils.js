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

/* 院校名称：招生计划用「院校名称」，总表兜底条目用「学校名称」 */
export function schoolName(row) {
  return row['院校名称'] || row['学校名称'] || '';
}

/* 同名院校可能有普通与专项两套招生代码；筛选和计数按招生代码区分。 */
export function admissionSchoolKey(row) {
  var name = String(row.schoolName || schoolName(row)).trim();
  var code = String(row.schoolCode || row['院校代号'] || '').trim();
  return code ? code + '|' + name : String(row.schoolId || name).trim();
}
