import { esc } from './utils.js';
import { getSortedYears } from './metadata.js';
import { buildSchoolDetailHtml, buildScoreSegmentsHtml, buildYearSummaryHtml } from './year-stack.js';

function statusHtml(model) {
  if (model.status === 'loading') return '<div class="result-state"><span class="loading">正在加载历年院校与一分一段数据…</span></div>';
  if (model.status === 'error') return '<div class="result-state result-error">加载失败：' + esc(model.error || '未知错误') + '</div>';
  if (model.status === 'unpublished') return '<div class="result-state">该年份数据尚未发布</div>';
  if (!model.hasQuery) return '<div class="result-state">输入专科专业，回车或点击查询开始检索</div>';
  return '<div class="result-state">当前筛选条件下没有符合的本科专业</div>';
}

function majorSummaryHtml(aggregate, metadata, index) {
  var major = aggregate.major || {};
  var course = major.professionalCourse || {};
  var years = (metadata.__selectedYears || getSortedYears(metadata));
  return '<article class="aggregate-card" data-major-index="' + index + '">' +
    '<header><div><h3>' + esc(major.majorName || '') + '</h3>' +
    '<p>专业代码 ' + esc(major.majorCode || '—') + ' · 公共课 ' + esc(major.publicCourse || '—') +
    ' · 专业基础课 ' + esc(course.name || '—') + (course.code ? ' (' + esc(course.code) + ')' : '') + '</p></div></header>' +
    '<div class="aggregate-years">' + years.map(function (year) {
      var yearAggregate = aggregate.years && aggregate.years[year];
      return '<section class="aggregate-year"><h4>' + year + ' 年</h4>' + buildYearSummaryHtml(yearAggregate) +
        '<button type="button" data-expand-year="' + year + '" data-major-index="' + index + '">展开院校与分数段</button>' +
        '<div class="aggregate-year-detail" data-year-detail="' + index + '-' + year + '"></div></section>';
    }).join('') + '</div></article>';
}

function toolbarHtml(model) {
  var cards = model.resultLayout !== 'table';
  return '<div class="result-toolbar" aria-label="结果显示设置">' +
    '<button type="button" data-result-action="years" aria-haspopup="dialog">年份</button>' +
    '<span class="result-layout-label">布局</span>' +
    '<button type="button" data-result-layout="cards"' + (cards ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>聚合卡片</button>' +
    '<button type="button" data-result-layout="table"' + (!cards ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>表格</button>' +
    '</div>';
}

function tableHeaderHtml(years) {
  return '<thead><tr><th>本科专业</th><th>公共课</th><th>专业基础课</th>' + years.map(function (year) {
    return '<th>' + year + ' 省控线</th><th>' + year + ' 院校(公/民)</th><th>' + year + ' 普通计划(公/民)</th><th>' + year + ' 专项计划(公/民)</th><th>' + year + ' 明细</th>';
  }).join('') + '</tr></thead>';
}

function tableRowsHtml(aggregates, years) {
  return aggregates.map(function (aggregate, index) {
    var major = aggregate.major || {};
    var course = major.professionalCourse || {};
    var values = years.map(function (year) {
      var value = (aggregate.years || {})[year] || {};
      var pub = value.publicSummary || {};
      var priv = value.privateSummary || {};
      return '<td>' + esc(value.score == null ? '—' : value.score) + '</td>' +
        '<td>' + esc((pub.schoolCount || 0) + '/' + (priv.schoolCount || 0)) + '</td>' +
        '<td>' + esc((pub.ordinaryPlanCount || 0) + '/' + (priv.ordinaryPlanCount || 0)) + '</td>' +
        '<td>' + esc((pub.povertyPlanCount || 0) + '/' + (priv.povertyPlanCount || 0)) + '</td>' +
        '<td><button type="button" data-expand-year="' + year + '" data-major-index="' + index + '">查看</button></td>';
    }).join('');
    var details = years.map(function (year) {
      return '<tr class="aggregate-table-detail"><td colspan="' + (3 + years.length * 5) + '"><div class="aggregate-year-detail" data-year-detail="' + index + '-' + year + '"></div></td></tr>';
    }).join('');
    return '<tr class="aggregate-table-row"><td>' + esc(major.majorName || '') + '</td><td>' + esc(major.publicCourse || '—') +
      '</td><td>' + esc(course.name || '—') + '</td>' + values + '</tr>' +
      details;
  }).join('');
}

function tableHtml(model, metadata) {
  var years = model.selectedYears || getSortedYears(metadata);
  return '<div class="aggregate-table-wrap"><table class="aggregate-table">' + tableHeaderHtml(years) +
    '<tbody>' + tableRowsHtml(model.aggregates || [], years) + '</tbody></table></div>';
}

export function buildYearDialogHtml(metadata, selectedYears) {
  var years = getSortedYears(metadata);
  var selected = selectedYears || years;
  return '<dialog class="year-selection-dialog" aria-labelledby="year-selection-title">' +
    '<form method="dialog"><h2 id="year-selection-title">年份范围</h2><p>勾选后会同步影响筛选、预览和导出。</p>' +
    '<fieldset><legend>展示年份</legend>' + years.map(function (year) {
      return '<label><input type="checkbox" name="selected-year" value="' + year + '"' +
        (selected.indexOf(year) >= 0 ? ' checked' : '') + '> ' + year + ' 年</label>';
    }).join('') + '</fieldset><p class="year-selection-error" aria-live="polite"></p>' +
    '<div class="year-selection-actions"><button type="button" data-year-select="all">全选</button>' +
    '<button type="button" data-year-select="latest">仅最新年份</button>' +
    '<button type="submit" value="cancel">取消</button><button type="button" data-year-apply>应用</button></div></form></dialog>';
}

export function buildResultWorkspaceHtml(model, metadata) {
  var aggregates = model.aggregates || [];
  if (!aggregates.length) return statusHtml(model);
  var selectedMetadata = { ...metadata, __selectedYears: model.selectedYears || getSortedYears(metadata) };
  var content = model.resultLayout === 'table' ? tableHtml(model, metadata) : '<div class="aggregate-list">' + aggregates.map(function (aggregate, index) {
    return majorSummaryHtml(aggregate, selectedMetadata, index);
  }).join('') + '</div>';
  return toolbarHtml(model) + content + buildYearDialogHtml(metadata, model.selectedYears);
}

export function buildExpandedYearHtml(aggregate, year) {
  var yearAggregate = aggregate && aggregate.years && aggregate.years[year];
  if (!yearAggregate) return '<div class="result-state">该年份数据尚未发布</div>';
  return '<div class="school-detail-list">' + (yearAggregate.schools || []).map(buildSchoolDetailHtml).join('') + '</div>' +
    buildScoreSegmentsHtml(yearAggregate.scoreSegments);
}

export function renderResultWorkspace(root, model, metadata, dispatch) {
  root.innerHTML = buildResultWorkspaceHtml(model, metadata);
  root.onclick = function (event) {
    var layout = event.target.closest('[data-result-layout]');
    if (layout && root.contains(layout)) {
      if (dispatch) dispatch({ type: 'SET_RESULT_LAYOUT', resultLayout: layout.dataset.resultLayout });
      return;
    }
    var yearAction = event.target.closest('[data-result-action="years"]');
    if (yearAction && root.contains(yearAction)) {
      var dialog = root.querySelector('.year-selection-dialog');
      if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
      else if (dialog) dialog.setAttribute('open', '');
      return;
    }
    var select = event.target.closest('[data-year-select]');
    if (select && root.contains(select)) {
      var dialogForSelect = root.querySelector('.year-selection-dialog');
      var selected = select.dataset.yearSelect === 'latest' ? [getSortedYears(metadata).at(-1)] : getSortedYears(metadata);
      dialogForSelect.querySelectorAll('input[name="selected-year"]').forEach(function (input) { input.checked = selected.indexOf(Number(input.value)) >= 0; });
      return;
    }
    var apply = event.target.closest('[data-year-apply]');
    if (apply && root.contains(apply)) {
      var dialogForApply = root.querySelector('.year-selection-dialog');
      var years = Array.from(dialogForApply.querySelectorAll('input[name="selected-year"]:checked')).map(function (input) { return Number(input.value); });
      var error = dialogForApply.querySelector('.year-selection-error');
      if (!years.length) {
        error.textContent = '请至少选择一个年份。';
        return;
      }
      if (dispatch) dispatch({ type: 'SET_SELECTED_YEARS', years: years });
      if (typeof dialogForApply.close === 'function') dialogForApply.close();
      else dialogForApply.removeAttribute('open');
      return;
    }
    var button = event.target.closest('[data-expand-year]');
    if (!button || !root.contains(button)) return;
    var majorIndex = Number(button.getAttribute('data-major-index'));
    var year = Number(button.getAttribute('data-expand-year'));
    var holder = root.querySelector('[data-year-detail="' + majorIndex + '-' + year + '"]');
    var opening = !holder.hasChildNodes();
    holder.innerHTML = opening ? buildExpandedYearHtml(model.aggregates[majorIndex], year) : '';
    button.textContent = opening ? '收起院校与分数段' : '展开院校与分数段';
    if (dispatch) dispatch({ type: opening ? 'EXPAND_YEAR' : 'COLLAPSE_YEAR', majorIndex: majorIndex, year: year });
  };
}
