/* ============================================================
   河南专升本 · 查询工具  —  汇总表模块
   把「专业查询」最近一次结果汇总为一张可自定义字段的表格：
   行 = 可报本科专业；列 = 省控线（2024/2025/2026）+
   招生院校数（分公办/民办） + 招生计划人数（分公办/民办合计）。
   年份与指标均可在页面上勾选替换，勾选后即时更新。
   不持有 DOM 引用（由入口传入 / 直接查 DOM），不依赖图表库。
   ============================================================ */

import { YEARS, getScore, getMajorYearStats } from './data.js';
import { getLastMajors, getLastSpecName } from './query.js';
import { esc } from './utils.js';

var $box = null;

function metricCells(major, metric, years) {
  var out = [];
  var stats = getMajorYearStats(major);
  years.forEach(function (y) {
    if (metric === 'score') {
      var s = getScore(major, y);
      out.push('<td class="sum-score">' + (s == null ? '—' : s) + '</td>');
    } else if (metric === 'schools') {
      var sc = stats.schools[y];
      out.push(sc.total
        ? '<td class="sum-num"><span class="n-pub">' + sc.pub + '</span> / <span class="n-min">' + sc.min + '</span></td>'
        : '<td class="sum-num na">—</td>');
    } else if (metric === 'plans') {
      var pl = stats.plans[y];
      out.push('<td class="sum-num">' +
        (pl.total
          ? '<span class="n-pub">' + pl.pub.toLocaleString() + '</span> / <span class="n-min">' + pl.min.toLocaleString() + '</span>'
          : '<span class="na">—</span>') +
        '</td>');
    }
  });
  return out.join('');
}

function render() {
  if (!$box) return;
  var majors = getLastMajors();
  var years = [];
  document.querySelectorAll('.fc-year:checked').forEach(function (c) { years.push(+c.value); });
  years.sort(function (a, b) { return a - b; });
  var metrics = [];
  document.querySelectorAll('.fc-metric:checked').forEach(function (c) { metrics.push(c.value); });

  if (!majors || !majors.length) {
    $box.innerHTML = '<div class="empty">还没有查询结果。请先在「专业查询」中输入专科专业并查询，再回到本页生成汇总表。</div>';
    return;
  }
  if (!years.length || !metrics.length) {
    $box.innerHTML = '<div class="empty">请至少勾选一个年份与一个指标。</div>';
    return;
  }

  /* 表头：指标 × 年份 分块 */
  var metricLabels = { score: '省控线', schools: '院校数（公办/民办）', plans: '计划人数（公办/民办）' };
  var head = '<th class="sum-major">可报本科专业</th>';
  metrics.forEach(function (m) {
    years.forEach(function (y) {
      head += '<th><span class="sum-metric">' + metricLabels[m] + '</span><span class="sum-year">' + y + '</span></th>';
    });
  });

  var rows = majors.map(function (m) {
    var nameHtml = esc(m['专业名称']);
    if (/职业教育/.test(m['专业名称'])) nameHtml += '<span class="tag">职教本科</span>';
    return '<tr><td class="major-name">' + nameHtml + '</td>' +
      metricCells(m, metrics[0], years) +
      (metrics.length > 1 ? metrics.slice(1).map(function (mm) { return metricCells(m, mm, years); }).join('') : '') +
      '</tr>';
  }).join('');

  $box.innerHTML =
    '<div class="sum-head"><b>' + esc(getLastSpecName()) + ' · 可报本科专业汇总表</b>' +
    '<span class="count">' + majors.length + ' 个专业 · ' + years.length + ' 个年份 · ' + metrics.length + ' 类指标</span></div>' +
    '<table class="sum-table"><colgroup><col class="c-major-sum">' +
    Array(years.length * metrics.length).fill('<col class="c-metric-sum">').join('') +
    '</colgroup><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table>';
}

/* 页面加载完成后初始化：读入勾选状态并绑定「勾选即更新」 */
export function initTable() {
  $box = document.getElementById('summary-table');
  if (!$box) return;
  var bind = function (sel) {
    document.querySelectorAll(sel).forEach(function (c) {
      c.addEventListener('change', function () { render(); });
    });
  };
  bind('.fc-year');
  bind('.fc-metric');
  render();
}

/* 切换到本页签时刷新（数据可能已更新） */
export function refreshTable() { render(); }
