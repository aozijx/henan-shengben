/* ============================================================
   河南专升本 · 查询工具  —  查询模块
   按专科专业查：输入关键词 → 匹配专科专业 → 展示可报本科专业
   （分数线 + 招生院校明细）。不持有 DOM 引用（由入口传入）。
   ============================================================ */

import { getMappingByYear, getMetadata, isReady } from './data.js';
import { esc } from './utils.js';
import { renderTable, renderMatchList } from './render.js';

var activeQueryYear = null;

export function setQueryYear(year) {
  activeQueryYear = Number.isInteger(year) ? year : null;
}

function currentQueryYear(metadata) {
  if (metadata && (metadata.supportedYears || []).indexOf(activeQueryYear) >= 0) return activeQueryYear;
  return metadata && metadata.defaultYear;
}

function currentMapping() {
  var metadata = getMetadata();
  return getMappingByYear(currentQueryYear(metadata));
}

export function findMappingMatches(mapping, keyword) {
  var kw = String(keyword || '').trim();
  return (mapping || []).filter(function (item) { return String(item['专科专业'] || '').indexOf(kw) > -1; });
}

export function resolveMappingMatch(mapping, keyword) {
  var kw = String(keyword || '').trim();
  var matches = findMappingMatches(mapping, kw);
  return matches.find(function (item) { return String(item['专科专业'] || '').trim() === kw; }) || matches[0] || null;
}

/* ---------- 建议填充（datalist） ---------- */
export function fillSuggest($suggest, kw) {
  $suggest.innerHTML = '';
  if (!kw || !isReady()) return;
  var n = 0;
  currentMapping().forEach(function (m) {
    var name = m['专科专业'];
    if (name.indexOf(kw) > -1 && n < 30) {
      var opt = document.createElement('option');
      opt.value = name;
      $suggest.appendChild(opt);
      n += 1;
    }
  });
}

/* 最近一次查询的可报本科专业列表（供筛选联动结果区复用） */
var lastMajors = [];
var lastSpecName = '';
var resultListener = null;
export function setResultListener(listener) { resultListener = listener; }

/* ---------- 查询入口 ---------- */
export function doQuery($q, $hint, $result) {
  if (!isReady()) return;
  var kw = ($q.value || '').trim();
  if (!kw) {
    $hint.textContent = '';
    lastMajors = [];
    lastSpecName = '';
    if (resultListener) resultListener([], '');
    $result.innerHTML = '<div class="empty">输入专业名称，回车或点「查询」开始检索</div>';
    return;
  }

  var mapping = currentMapping();
  var matches = findMappingMatches(mapping, kw);
  if (!matches.length) {
    $hint.textContent = '';
    lastMajors = [];
    lastSpecName = '';
    if (resultListener) resultListener([], '');
    var metadata = getMetadata();
    $result.innerHTML = '<div class="msg-notfound">未找到专科专业「' + esc(kw) + '」。<br>' +
      '可尝试：关键词的一部分（如「物联网」）；' +
      '本工具收录 ' + (currentQueryYear(metadata) || '') + ' 年对照一览表中的 ' + mapping.length + ' 个专科专业。</div>';
    return;
  }
  var spec = resolveMappingMatch(mapping, kw);
  if (matches.length > 1) {
    renderMatchList($result, matches.map(function (m) { return { name: m['专科专业'] }; }),
      function (it) { showSpec($q, $hint, $result, findSpecByName(it.name)); }, '专科专业');
  }
  showSpec($q, $hint, $result, spec);
}

function findSpecByName(name) {
  var mapping = currentMapping();
  for (var i = 0; i < mapping.length; i++) if (mapping[i]['专科专业'] === name) return mapping[i];
  return null;
}

function showSpec($q, $hint, $result, spec) {
  if (!spec) return;
  $q.value = spec['专科专业'];
  var majors = spec['可报本科专业'] || [];
  lastMajors = majors;
  lastSpecName = spec['专科专业'];
  if (resultListener) resultListener(majors, lastSpecName);
  var metadata = getMetadata();
  $hint.textContent = spec['专科专业'] + ' · 共 ' + majors.length + ' 个可报本科专业（' + (currentQueryYear(metadata) || '') + ' 对照一览表）';
  if (!majors.length) {
    $result.innerHTML = '<div class="empty">「' + esc(spec['专科专业']) + '」暂无可报本科专业数据</div>';
    return;
  }
  renderTable($result, spec['专科专业'] + ' → 可报本科专业', majors, majors.length + ' 个专业');
}

/* ---------- 筛选联动：把筛选后的专业列表重渲染到结果区 ----------
   由 explorer 在筛选/排序变化时回调，majors 为按原顺序排列的可报本科专业。
   未查询或查询为空时不动作；全部被筛掉时给出明确提示。 */
export function renderFilteredResult($result, majors, note) {
  if (!isReady() || !lastMajors.length) return;
  if (!majors.length) {
    $result.innerHTML = '<div class="empty">当前筛选条件下没有符合的本科专业（原有 ' +
      lastMajors.length + ' 个），可调整或重置下方筛选。</div>';
    return;
  }
  renderTable($result, lastSpecName + ' → 可报本科专业', majors, note || (majors.length + ' 个专业'));
}
