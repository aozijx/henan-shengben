/* ============================================================
   河南专升本 · 查询工具  —  查询模块
   按专科专业查：输入关键词 → 匹配专科专业 → 展示可报本科专业
   （分数线 + 招生院校明细）。不持有 DOM 引用（由入口传入）。
   ============================================================ */

import { MAPPING, isReady } from './data.js';
import { esc } from './utils.js';
import { renderTable, renderMatchList } from './render.js';

/* ---------- 建议填充（datalist） ---------- */
export function fillSuggest($suggest, kw) {
  $suggest.innerHTML = '';
  if (!kw || !isReady()) return;
  var n = 0;
  MAPPING.forEach(function (m) {
    var name = m['专科专业'];
    if (name.indexOf(kw) > -1 && n < 30) {
      var opt = document.createElement('option');
      opt.value = name;
      $suggest.appendChild(opt);
      n += 1;
    }
  });
}

/* 最近一次查询的可报本科专业列表（供汇总表等模块复用） */
var lastMajors = [];
var lastSpecName = '';
export function getLastMajors() { return lastMajors; }
export function getLastSpecName() { return lastSpecName; }

/* ---------- 查询入口 ---------- */
export function doQuery($q, $hint, $result) {
  if (!isReady()) return;
  var kw = ($q.value || '').trim();
  if (!kw) {
    $hint.textContent = '';
    lastMajors = [];
    lastSpecName = '';
    $result.innerHTML = '<div class="empty">输入专业名称，回车或点「查询」开始检索</div>';
    return;
  }

  var matches = MAPPING.filter(function (m) { return m['专科专业'].indexOf(kw) > -1; });
  if (!matches.length) {
    $hint.textContent = '';
    lastMajors = [];
    lastSpecName = '';
    $result.innerHTML = '<div class="msg-notfound">未找到专科专业「' + esc(kw) + '」。<br>' +
      '可尝试：关键词的一部分（如「物联网」）；' +
      '本工具收录 2026 年对照一览表中的 ' + MAPPING.length + ' 个专科专业。</div>';
    return;
  }
  var spec = matches[0];
  if (matches.length > 1) {
    renderMatchList($result, matches.map(function (m) { return { name: m['专科专业'] }; }),
      function (it) { showSpec($hint, $result, findSpecByName(it.name)); }, '专科专业');
  }
  showSpec($hint, $result, spec);
}

function findSpecByName(name) {
  for (var i = 0; i < MAPPING.length; i++) if (MAPPING[i]['专科专业'] === name) return MAPPING[i];
  return null;
}

function showSpec($hint, $result, spec) {
  if (!spec) return;
  var majors = spec['可报本科专业'] || [];
  lastMajors = majors;
  lastSpecName = spec['专科专业'];
  $hint.textContent = spec['专科专业'] + ' · 共 ' + majors.length + ' 个可报本科专业（2026 对照一览表）';
  if (!majors.length) {
    $result.innerHTML = '<div class="empty">「' + esc(spec['专科专业']) + '」暂无可报本科专业数据</div>';
    return;
  }
  renderTable($result, spec['专科专业'] + ' → 可报本科专业', majors, majors.length + ' 个专业');
}
