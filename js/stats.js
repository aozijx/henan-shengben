/* ============================================================
   河南专升本 · 查询工具  —  数据分析模块
   ECharts 三张图（区间分布 / TOP15 / 专业走势），
   ECharts 加载失败时自动降级为静态表格，展示同样数字。
   ============================================================ */

import { SCORE_BY_YEAR, YEARS, getScoreIndex, getPlanStats, getPlansByYear } from './data.js';
import { chartPalette } from './theme.js';
import { esc, schoolName } from './utils.js';

var charts = {};              // 图表实例
var chartsResizeBound = false;
var fallbackRendered = false;

var TREND_MAJORS = [
  { name: '计算机科学与技术', code: '51' }, { name: '软件工程', code: '52' },
  { name: '物联网工程', code: '54' }, { name: '电气工程及其自动化', code: '43' },
  { name: '会计学', code: '99' }, { name: '汉语言文学', code: 'B2' },
  { name: '护理学', code: 'D2' }, { name: '临床医学', code: 'C4' }
];
var BINS = [[80, 100], [100, 120], [120, 140], [140, 160], [160, 180], [180, 200], [200, 220], [220, 240], [240, 261]];

export function buildStatsYearContext(years) {
  var sorted = (years || []).slice().sort(function (a, b) { return a - b; });
  return { years: sorted, latestYear: sorted.length ? sorted[sorted.length - 1] : null };
}

function binLabel(b) { return (b[1] > 250 ? '240+' : b[0] + '–' + (b[1] - 1)); }

function binCounts(year) {
  return BINS.map(function (b) {
    return (SCORE_BY_YEAR[year] || []).filter(function (e) {
      return e['分数线'] >= b[0] && e['分数线'] < b[1];
    }).length;
  });
}

export function initCharts() {
  renderPlanOverview();
  if (!window.echarts) { renderFallbackStats(); return; }
  var distEl = document.getElementById('chart-dist');
  var topEl = document.getElementById('chart-top');
  var trendEl = document.getElementById('chart-trend');
  if (!distEl || !topEl || !trendEl) return;

  var C = chartPalette();
  var yearContext = buildStatsYearContext(YEARS);
  var years = yearContext.years;
  var latestYear = yearContext.latestYear;
  var yearColor = function (index) { return C.trends[index % C.trends.length]; };

  var distOpt = {
    animation: false, grid: { left: 42, right: 16, top: 34, bottom: 30 },
    tooltip: { trigger: 'axis', confine: true },
    legend: { data: years.map(String), top: 2, icon: 'rect', textStyle: { color: C.muted } },
    xAxis: { type: 'category', data: BINS.map(binLabel), axisLabel: { color: C.muted, fontSize: 11 } },
    yAxis: { type: 'value', minInterval: 1, name: '专业数', nameTextStyle: { color: C.faint }, axisLabel: { color: C.muted }, splitLine: { lineStyle: { color: C.grid } } },
    series: years.map(function (year, index) {
      return { name: String(year), type: 'bar', data: binCounts(year), itemStyle: { color: yearColor(index), borderRadius: [2, 2, 0, 0] }, barGap: index ? undefined : '20%' };
    })
  };

  var top15 = (SCORE_BY_YEAR[latestYear] || []).slice().sort(function (a, b) { return b['分数线'] - a['分数线']; }).slice(0, 15).reverse();
  var topOpt = {
    animation: false, grid: { left: 120, right: 44, top: 8, bottom: 8 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true },
    xAxis: { type: 'value', name: '分数线', nameTextStyle: { color: C.faint }, axisLabel: { color: C.muted }, splitLine: { lineStyle: { color: C.grid } } },
    yAxis: { type: 'category', data: top15.map(function (e) { return e['专业名称']; }), axisLabel: { color: C.ink, fontSize: 12 } },
    series: [{ type: 'bar', data: top15.map(function (e) { return e['分数线']; }), itemStyle: { color: yearColor(years.length - 1), borderRadius: [0, 3, 3, 0] }, label: { show: true, position: 'right', fontSize: 11, color: C.ink, fontFamily: 'monospace' } }]
  };

  var scoreIndex = getScoreIndex();
  var trendSeries = TREND_MAJORS.map(function (tm, i) {
    var color = C.trends[i];
    var vals = YEARS.map(function (y) {
      var db = scoreIndex[y];
      return db && db[tm.code] ? db[tm.code].score : null;
    });
    return {
      name: tm.name, type: 'line', smooth: false, symbolSize: 5,
      data: vals, itemStyle: { color: color }, lineStyle: { color: color, width: 2 },
      emphasis: { focus: 'series' },
      endLabel: { show: true, formatter: function (p) { return tm.name + ' ' + (p.value == null ? '—' : p.value); }, fontSize: 11, color: color }
    };
  });
  var trendOpt = {
    animation: false, grid: { left: 44, right: 150, top: 20, bottom: 30 },
    tooltip: { trigger: 'axis', confine: true },
    legend: { show: false },
    xAxis: { type: 'category', data: years.map(String), axisLabel: { color: C.muted } },
    yAxis: { type: 'value', name: '控制线', nameTextStyle: { color: C.faint }, axisLabel: { color: C.muted }, splitLine: { lineStyle: { color: C.grid } } },
    series: trendSeries
  };

  if (charts.dist) charts.dist.dispose();
  if (charts.top) charts.top.dispose();
  if (charts.trend) charts.trend.dispose();
  charts.dist = window.echarts.init(distEl); charts.dist.setOption(distOpt);
  charts.top = window.echarts.init(topEl); charts.top.setOption(topOpt);
  charts.trend = window.echarts.init(trendEl); charts.trend.setOption(trendOpt);

  if (!chartsResizeBound) {
    window.addEventListener('resize', function () {
      Object.keys(charts).forEach(function (k) {
        if (charts[k] && charts[k].resize) charts[k].resize();
      });
    });
    chartsResizeBound = true;
  }
}

/* 最新已发布年份招生计划概览（独立于图表库，纯 HTML 统计卡） */
export function renderPlanOverview() {
  var box = document.getElementById('plan-overview');
  if (!box || box.dataset.rendered) return;
  var latestYear = buildStatsYearContext(YEARS).latestYear;
  var plans = getPlansByYear(latestYear);
  var s = getPlanStats(latestYear);
  var schools = {};
  var minS = {}, pubS = {};
  plans.forEach(function (r) {
    var sn = schoolName(r);
    schools[sn] = 1;
    if (r['办学性质'] === '民办') minS[sn] = 1;
    else pubS[sn] = 1;
  });
  box.dataset.rendered = '1';
  box.innerHTML =
    '<div class="plan-card"><b>' + s['条数'] + '</b><span>院校专业条目</span></div>' +
    '<div class="plan-card"><b>' + Object.keys(schools).length + '</b><span>招生院校（公办 ' + Object.keys(pubS).length + ' · 民办 ' + Object.keys(minS).length + '）</span></div>' +
    '<div class="plan-card"><b>' + s['建档立卡专项'] + '</b><span>建档立卡专项条目</span></div>' +
    '<div class="plan-card"><b>' + s['计划人数合计'].toLocaleString() + '</b><span>计划招生人数</span></div>';
}



function renderFallbackStats() {
  if (fallbackRendered) return;
  var yearContext = buildStatsYearContext(YEARS);
  var years = yearContext.years;
  var latestYear = yearContext.latestYear;
  var yearHeaders = years.map(function (year) { return '<th>' + year + '</th>'; }).join('');
  var distHtml = '<div class="table-wrap"><table style="min-width:0"><thead><tr><th style="width:40%">区间</th>' + yearHeaders + '</tr></thead><tbody>' +
    BINS.map(function (b) {
      var cell = function (y) {
        return (SCORE_BY_YEAR[y] || []).filter(function (e) { return e['分数线'] >= b[0] && e['分数线'] < b[1]; }).length;
      };
      return '<tr><td>' + binLabel(b) + '</td>' + years.map(function (year) { return '<td>' + cell(year) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
  var topHtml = '<div class="table-wrap"><table style="min-width:0"><thead><tr><th style="width:12%">名次</th><th>专业</th><th style="width:20%">' + latestYear + ' 控制线</th></tr></thead><tbody>' +
    (SCORE_BY_YEAR[latestYear] || []).slice().sort(function (a, b) { return b['分数线'] - a['分数线']; }).slice(0, 15).map(function (e, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(e['专业名称']) + '</td><td class="score hot">' + e['分数线'] + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  var scoreIndex = getScoreIndex();
  var trendRows = TREND_MAJORS.map(function (tm) {
    var cell = function (y) { var db = scoreIndex[y]; return db && db[tm.code] ? db[tm.code].score : '—'; };
    return '<tr><td>' + tm.name + '</td>' + years.map(function (year) { return '<td>' + cell(year) + '</td>'; }).join('') + '</tr>';
  }).join('');
  var trendHtml = '<div class="table-wrap"><table style="min-width:0"><thead><tr><th style="width:44%">专业</th>' + yearHeaders + '</tr></thead><tbody>' + trendRows + '</tbody></table></div>';

  document.getElementById('chart-dist').outerHTML = '<div class="chart-card"><h3>近三年控制线区间分布（离线表格版）</h3>' + distHtml + '</div>';
  document.getElementById('chart-top').outerHTML = '<div class="chart-card"><h3>' + latestYear + ' 年控制线 TOP 15（离线表格版）</h3>' + topHtml + '</div>';
  document.getElementById('chart-trend').outerHTML = '<div class="chart-card"><h3>八个常见专业三年走势（离线表格版）</h3>' + trendHtml + '</div>';
  fallbackRendered = true;
}
