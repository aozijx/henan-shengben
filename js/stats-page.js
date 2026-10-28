import { projectAnalytics } from './analytics-projection.js';
import { buildCurve, lookupScoreSegmentCode } from './score-curves.js';
import { esc } from './utils.js';
import { buildPaginationHtml, paginate } from './table-utils.js';
import { hiddenResultFields, resultFieldVisible } from './result-visibility.js';
import { hasMasterMarkFilter } from './master-flags.js';
import { chartPalette } from './theme.js';

var chartInstances = {};
var selectedCodes = new Set();
var page = 1;
var pageGeneration = 0;
var curveGeneration = 0;
var context = null;
function majorKey(major) { return major.majorCode + '|' + major.majorName; }

function themedAxis(axis, palette) {
  if (!axis) return axis;
  var result = { ...axis };
  result.axisLabel = { color: palette.muted, ...(axis.axisLabel || {}) };
  result.nameTextStyle = { color: palette.faint, ...(axis.nameTextStyle || {}) };
  result.axisLine = { ...(axis.axisLine || {}), lineStyle: { color: palette.line, ...((axis.axisLine || {}).lineStyle || {}) } };
  result.axisTick = { ...(axis.axisTick || {}), lineStyle: { color: palette.line, ...((axis.axisTick || {}).lineStyle || {}) } };
  result.splitLine = { ...(axis.splitLine || {}), lineStyle: { color: palette.grid, ...((axis.splitLine || {}).lineStyle || {}) } };
  return result;
}

function themedOption(option) {
  var palette = chartPalette();
  var result = { ...option, textStyle: { color: palette.ink, fontFamily: palette.fontFamily, ...(option.textStyle || {}) } };
  if (option.tooltip) {
    var axisPointer = option.tooltip.axisPointer || {};
    result.tooltip = { ...option.tooltip, backgroundColor: palette.surface, borderColor: palette.line,
      textStyle: { color: palette.ink, fontFamily: palette.fontFamily, ...((option.tooltip || {}).textStyle || {}) },
      axisPointer: { ...axisPointer,
        label: { color: palette.ink, backgroundColor: palette.surface, borderColor: palette.line, ...(axisPointer.label || {}) } } };
  }
  if (option.legend) {
    result.legend = Array.isArray(option.legend) ? option.legend.map(function (legend) {
      return { ...legend, textStyle: { color: palette.muted, ...(legend.textStyle || {}) } };
    }) : { ...option.legend, textStyle: { color: palette.muted, ...(option.legend.textStyle || {}) } };
  }
  if (option.xAxis) result.xAxis = Array.isArray(option.xAxis)
    ? option.xAxis.map(function (axis) { return themedAxis(axis, palette); }) : themedAxis(option.xAxis, palette);
  if (option.yAxis) result.yAxis = Array.isArray(option.yAxis)
    ? option.yAxis.map(function (axis) { return themedAxis(axis, palette); }) : themedAxis(option.yAxis, palette);
  return result;
}

function draw(id, option) {
  var el = document.getElementById(id);
  if (!el || !window.echarts) return false;
  if (chartInstances[id]) chartInstances[id].dispose();
  chartInstances[id] = window.echarts.init(el);
  chartInstances[id].setOption(themedOption(option));
  return true;
}

function summary(projection, hiddenFields) {
  var focus = projection.focusYear;
  var rows = projection.majors.map(function (major) { return { major: major, value: major.years[focus] }; })
    .filter(function (item) { return item.value; });
  var total = rows.reduce(function (sum, item) { return sum + item.value.planCount; }, 0);
  var publicPlan = rows.reduce(function (sum, item) { var part = item.value.schoolTypes.public; return sum + (part ? part.ordinaryPlanCount + part.povertyPlanCount : 0); }, 0);
  var privatePlan = rows.reduce(function (sum, item) { var part = item.value.schoolTypes.private; return sum + (part ? part.ordinaryPlanCount + part.povertyPlanCount : 0); }, 0);
  var ordinaryPlan = rows.reduce(function (sum, item) { return sum + item.value.ordinaryPlanCount; }, 0);
  var povertyPlan = rows.reduce(function (sum, item) { return sum + item.value.povertyPlanCount; }, 0);
  document.getElementById('plan-overview').innerHTML =
    '<div class="plan-card"><b>' + rows.length + '</b><span>匹配专业</span></div>' +
    (povertyPlan > 0 ? '<div class="plan-card"><b>' + total.toLocaleString() + '</b><span>计划人数（逐专业汇总）</span></div>' : '') +
    '<div class="plan-card"><b>' + publicPlan.toLocaleString() + '</b><span>公办计划</span></div>' +
    '<div class="plan-card"><b>' + privatePlan.toLocaleString() + '</b><span>民办计划</span></div>' +
    '<div class="plan-card"><b>' + ordinaryPlan.toLocaleString() + '</b><span>普通计划</span></div>' +
    (resultFieldVisible(hiddenFields, 'povertyPlan') ? '<div class="plan-card"><b>' + povertyPlan.toLocaleString() + '</b><span>专项计划</span></div>' : '');
  var bins = [];
  for (var start = 0; start < 300; start += 20) bins.push(start);
  var years = projection.years;
  var dist = years.map(function (year) {
    return { name: String(year), type: 'bar', data: bins.map(function (start) {
      return projection.majors.filter(function (major) {
        var score = major.years[year] && major.years[year].score;
        return score != null && score >= start && score < start + 20;
      }).length;
    }) };
  });
  if (!draw('chart-dist', { tooltip: { trigger: 'axis' }, legend: {},
    xAxis: { type: 'category', data: bins.map(function (start) { return start + '–' + (start + 19); }) },
    yAxis: { type: 'value', name: '专业数' }, series: dist })) {
    document.getElementById('chart-dist').textContent = years.map(function (year, index) {
      return year + ' 年：' + dist[index].data.join('、');
    }).join('；');
  }
  var top = rows.filter(function (item) { return item.value.score != null; })
    .sort(function (a, b) { return b.value.score - a.value.score || a.major.majorCode.localeCompare(b.major.majorCode); })
    .slice(0, 15).reverse();
  if (!draw('chart-top', { grid: { left: 135, right: 30 }, tooltip: { trigger: 'axis' },
    xAxis: { type: 'value' }, yAxis: { type: 'category', data: top.map(function (item) { return item.major.majorName; }) },
    series: [{ type: 'bar', data: top.map(function (item) { return item.value.score; }) }] })) {
    document.getElementById('chart-top').innerHTML = top.slice().reverse().map(function (item) {
      return '<p>' + esc(item.major.majorName) + ' · ' + item.value.score + '</p>';
    }).join('');
  }
  var trend = selectedCodes.size ? projection.majors.filter(function (major) { return selectedCodes.has(majorKey(major)); }) : projection.majors.slice(0, 8);
  if (!draw('chart-trend', { tooltip: { trigger: 'axis' }, legend: { type: 'scroll' },
    xAxis: { type: 'category', data: years.map(String) }, yAxis: { type: 'value', name: '控制线' },
    series: trend.map(function (major) { return { name: major.majorName, type: 'line', data: years.map(function (year) {
      return major.years[year] && major.years[year].score;
    }) }; }) })) {
    document.getElementById('chart-trend').textContent = trend.map(function (major) {
      return major.majorName + '：' + years.map(function (year) { return major.years[year]?.score ?? '—'; }).join(' / ');
    }).join('；');
  }
}

export function buildStatsTableHtml(projection, metadata, requestedPage, hiddenFields) {
  var current = paginate(projection.majors, requestedPage, metadata.pageSize || 50);
  var rows = current.rows;
  return '<div class="table-wrap"><table><thead><tr><th>本科专业</th>' + projection.years.map(function (year) {
    return '<th>' + year + ' 年控制线 / 院校 / 计划</th>';
  }).join('') + '</tr></thead><tbody>' + rows.map(function (major) {
    return '<tr><td>' + esc(major.majorName) + ' (' + esc(major.majorCode) + ')</td>' + projection.years.map(function (year) {
      var value = major.years[year];
      if (!value) return '<td>—</td>';
      var pub = value.schoolTypes.public || {};
      var priv = value.schoolTypes.private || {};
      return '<td><div class="stats-year-cell"><b>' + esc(value.score ?? '—') + ' 分</b>' +
        '<span>院校 公 ' + (pub.schoolCount || 0) + ' / 民 ' + (priv.schoolCount || 0) + '</span>' +
        (resultFieldVisible(hiddenFields, 'povertyPlan') ? '<span>普通 ' + (value.ordinaryPlanCount || 0) +
          ' / 专项 ' + (value.povertyPlanCount || 0) + ' 人</span>' : '<span>普通 ' + (value.ordinaryPlanCount || 0) + ' 人</span>') +
        '</div></td>';
    }).join('') + '</tr>';
  }).join('') + '</tbody></table></div><p class="stats-table-total">共 ' + current.total + ' 个专业 · 当前 ' + current.start + '–' + current.end + '</p>' +
    buildPaginationHtml(current.page, current.pageCount, '专业列表分页');
}

function renderTable(projection, metadata, hiddenFields) {
  var current = paginate(projection.majors, page, metadata.pageSize || 50);
  page = current.page;
  var root = document.getElementById('stats-table');
  root.innerHTML = buildStatsTableHtml(projection, metadata, page, hiddenFields);
  root.querySelectorAll('.table-pagination [data-page]').forEach(function (button) {
    button.onclick = function () { page = Number(button.dataset.page); renderTable(projection, metadata, hiddenFields); };
  });
}

async function renderCurves() {
  if (!context) return;
  var token = ++curveGeneration;
  var { projection, repository } = context;
  var chosen = projection.majors.filter(function (row) { return selectedCodes.has(majorKey(row)); });
  var fallback = document.getElementById('stats-curve-fallback');
  if (!chosen.length) { fallback.textContent = '勾选专业后显示一分一段。';
    if (chartInstances['chart-segments']) { chartInstances['chart-segments'].dispose(); delete chartInstances['chart-segments']; }
    return; }
  fallback.textContent = '正在读取所选专业的分数段…';
  try {
    var indexes = await Promise.all(projection.years.map(function (year) {
      return repository.ensureScoreSegmentIndex(year).catch(function () { return null; });
    }));
    var shards = await Promise.all(chosen.flatMap(function (major) { return projection.years.map(function (year, index) {
      var shardCode = lookupScoreSegmentCode(indexes[index], major.majorCode);
      return (shardCode ? repository.ensureScoreSegment(year, shardCode) : Promise.resolve(null))
        .then(function (value) { return { major, year, value }; })
        .catch(function () { return { major, year, value: null }; });
    }); }));
    if (token !== curveGeneration) return;
    var mode = document.getElementById('stats-curve-mode').value;
    var series = shards.filter(function (item) { return item.value; }).map(function (item) {
      return { name: item.year + ' ' + item.major.majorName, type: 'line', showSymbol: false,
        data: buildCurve(item.value, mode) };
    });
    var missing = shards.length - series.length;
    fallback.textContent = missing ? missing + ' 组数据未发布或加载失败，可重新勾选重试。' : '';
    if (!draw('chart-segments', { tooltip: { trigger: 'axis' }, legend: { type: 'scroll' },
      xAxis: { type: 'value', name: mode === 'rank' ? '位次' : '分数' },
      yAxis: { type: 'value', name: mode === 'rank' ? '分数' : mode === 'percent' ? '累计百分比 %' : '人数' }, series: series })) {
      fallback.textContent += series.map(function (item) { return item.name + '：' + item.data.length + ' 个分数段'; }).join('；');
    }
  } catch (error) { if (token === curveGeneration) fallback.textContent = error.message; }
}

function choices(projection, hiddenFields) {
  var root = document.getElementById('stats-major-choices');
  var search = document.getElementById('stats-major-search');
  var keyword = search.value.trim();
  var visible = projection.majors.filter(function (major) {
    return !keyword || major.majorName.includes(keyword) || major.majorCode.includes(keyword);
  });
  function selectVisible() {
    visible.forEach(function (major) { selectedCodes.add(majorKey(major)); });
    choices(projection, hiddenFields); summary(projection, hiddenFields); renderCurves();
  }
  root.innerHTML = visible.map(function (major) { return '<label><input type="checkbox" value="' + esc(majorKey(major)) + '"' +
    (selectedCodes.has(majorKey(major)) ? ' checked' : '') + '> ' + esc(major.majorName) + ' (' + esc(major.majorCode) + ')</label>'; }).join('') || '没有匹配的专业';
  root.querySelectorAll('input').forEach(function (input) { input.onchange = function () {
    if (input.checked) selectedCodes.add(input.value); else selectedCodes.delete(input.value);
    document.getElementById('stats-selected-count').textContent = '已勾选 ' + selectedCodes.size + ' 个专业';
    summary(projection, hiddenFields); renderCurves();
  }; });
  document.getElementById('stats-selected-count').textContent = '已勾选 ' + selectedCodes.size + ' 个专业';
  document.getElementById('stats-clear-selected').onclick = function () {
    selectedCodes.clear(); choices(projection, hiddenFields); summary(projection, hiddenFields); renderCurves();
  };
  search.oninput = function () { choices(projection, hiddenFields); };
  search.onkeydown = function (event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    selectVisible();
  };
  document.getElementById('stats-curve-mode').onchange = renderCurves;
}

export async function renderStatsPage(repository, metadata, state, mapping) {
  var token = ++pageGeneration;
  ++curveGeneration;
  var status = document.getElementById('stats-status');
  var cards = document.querySelectorAll('#view-stats .chart-card');
  status.textContent = '正在读取年度统计…';
  try {
    var years = state.selectedYears.filter(function (year) { return Boolean(metadata.yearSources[year]); });
    if (!years.length) {
      cards.forEach(function (card) { card.hidden = true; });
      document.getElementById('stats-context').textContent = '年份：' + state.selectedYears.join('、');
      status.textContent = '所选年份的省控线及年度统计尚未公布。';
      return;
    }
    cards.forEach(function (card) { card.hidden = false; });
    var documents = await Promise.all(years.map(function (year) {
      return Promise.all([repository.ensureAnalytics(year), repository.ensureCollegeMaster(year)]);
    }));
    if (token !== pageGeneration) return;
    var analytics = Object.fromEntries(years.map(function (year, index) { return [year, documents[index][0]]; }));
    var masters = Object.fromEntries(years.map(function (year, index) { return [year, documents[index][1]]; }));
    var projection = projectAnalytics(analytics, mapping, years, state.filters,
      state.specName ? state.majors : null, masters, metadata);
    document.querySelectorAll('[data-stats-focus-year]').forEach(function (node) {
      node.textContent = String(projection.focusYear || '最新');
    });
    var allowed = new Set(projection.majors.map(majorKey));
    var removed = 0;
    selectedCodes.forEach(function (code) { if (!allowed.has(code)) { selectedCodes.delete(code); removed += 1; } });
    context = { projection, repository };
    var hiddenFields = hiddenResultFields(metadata, state.filters);
    var filterLabels = metadata.fields.filter(function (field) {
      return field.filterEnable && field.type === 'enum';
    }).map(function (field) {
      return field.label + '：' + (state.filters[field.key] || '全部');
    });
    document.getElementById('stats-context').textContent = ['年份：' + projection.years.join('、')]
      .concat(filterLabels, [projection.majors.length + ' 个专业']).join(' · ');
    status.textContent = [removed ? '条件变化，已取消 ' + removed + ' 个专业的勾选。' : '',
      years.length < state.selectedYears.length ? '部分年份的分数统计尚未公布。' : '',
      hasMasterMarkFilter(state.filters, metadata) ? '统计人数只计已单列招生计划；总表未单列院校见查询结果。' : '']
      .filter(Boolean).join(' ');
    summary(projection, hiddenFields); renderTable(projection, metadata, hiddenFields); choices(projection, hiddenFields); renderCurves();
  } catch (error) { if (token === pageGeneration) status.textContent = '统计加载失败：' + error.message; }
}
