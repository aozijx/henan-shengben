/* ============================================================
   河南专升本 · 查询工具  —  查询模块
   按专科专业查：输入关键词 → 匹配专科专业 → 展示可报本科专业
   通过结果监听器交给聚合工作区渲染。不持有 DOM 引用（由入口传入）。
   ============================================================ */

import { getMappingByYear, getMetadata, isReady } from './data.js';
import { setResultState } from './results-controller.js';

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

var resultListener = null;
export function setResultListener(listener) { resultListener = listener; }

/* ---------- 查询入口 ---------- */
export function doQuery($q, $hint, $result) {
  if (!isReady()) return;
  var kw = ($q.value || '').trim();
  if (!kw) {
    $hint.textContent = '';
    if (resultListener) resultListener([], '');
    setResultState($result, '输入专科专业，回车或点击查询开始检索', 'empty');
    return;
  }

  var mapping = currentMapping();
  var matches = findMappingMatches(mapping, kw);
  if (!matches.length) {
    $hint.textContent = '';
    if (resultListener) resultListener([], '');
    var metadata = getMetadata();
    setResultState($result, '未找到专科专业「' + kw + '」。可尝试输入关键词的一部分（如「物联网」）；本工具收录 ' +
      (currentQueryYear(metadata) || '') + ' 年对照一览表中的 ' + mapping.length + ' 个专科专业。', 'empty');
    return;
  }
  var spec = resolveMappingMatch(mapping, kw);
  showSpec($q, $hint, $result, spec);
}

function showSpec($q, $hint, $result, spec) {
  if (!spec) return;
  $q.value = spec['专科专业'];
  var majors = spec['可报本科专业'] || [];
  if (resultListener) resultListener(majors, spec['专科专业']);
  var metadata = getMetadata();
  $hint.textContent = spec['专科专业'] + ' · 共 ' + majors.length + ' 个可报本科专业（' + (currentQueryYear(metadata) || '') + ' 对照一览表）';
  if (!majors.length) {
    setResultState($result, '「' + spec['专科专业'] + '」暂无可报本科专业数据', 'empty');
    return;
  }
}
