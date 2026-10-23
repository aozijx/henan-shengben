import { esc } from './utils.js';
import { getSortedYears, normalizeSelectedYears } from './metadata.js';
import { buildSchoolDetailHtml, buildScoreSegmentsHtml, buildYearSummaryHtml } from './year-stack.js';

var resultViewStates = new WeakMap();

function statusHtml(model) {
  if (model.status === 'loading') return '<div class="result-state"><span class="loading">正在加载历年院校与一分一段数据…</span></div>';
  if (model.status === 'error') return '<div class="result-state result-error">加载失败：' + esc(model.error || '未知错误') + '</div>';
  if (model.status === 'unpublished') return '<div class="result-state">该年份数据尚未发布</div>';
  if (!model.hasQuery) return '<div class="result-state">输入专科专业，回车或点击查询开始检索</div>';
  return '<div class="result-state">当前筛选条件下没有符合的本科专业</div>';
}

function selectedYears(model, metadata) {
  return normalizeSelectedYears(model.selectedYears, metadata);
}

export function buildResultViewModel(model, metadata) {
  var source = model || {};
  var years = selectedYears(source, metadata);
  return {
    ...source,
    aggregates: Array.isArray(source.aggregates) ? source.aggregates : [],
    selectedYears: years,
    resultLayout: source.resultLayout === 'table' ? 'table' : 'cards',
    expandedDetails: { ...(source.expandedDetails || {}) }
  };
}

function detailKey(index, year) {
  return index + '-' + year;
}

function detailButtonHtml(year, index, label, expanded) {
  var buttonLabel = expanded ? '收起详情' : label;
  return '<button type="button" data-expand-year="' + year + '" data-major-index="' + index +
    '" data-expand-label="' + esc(label) + '" aria-expanded="' + String(expanded) + '">' + esc(buttonLabel) + '</button>';
}

function detailHtml(aggregate, year, expanded) {
  return expanded ? buildExpandedYearHtml(aggregate, year) : '';
}

function majorSummaryHtml(aggregate, years, index, expandedDetails) {
  var major = aggregate.major || {};
  var course = major.professionalCourse || {};
  return '<article class="aggregate-card" data-major-index="' + index + '">' +
    '<header><div><h3>' + esc(major.majorName || '') + '</h3>' +
    '<p>专业代码 ' + esc(major.majorCode || '—') + ' · 公共课 ' + esc(major.publicCourse || '—') +
    ' · 专业基础课 ' + esc(course.name || '—') + (course.code ? ' (' + esc(course.code) + ')' : '') + '</p></div></header>' +
    '<div class="aggregate-years">' + years.map(function (year) {
      var yearAggregate = aggregate.years && aggregate.years[year];
      return '<section class="aggregate-year"><h4>' + year + ' 年</h4>' + buildYearSummaryHtml(yearAggregate) +
        detailButtonHtml(year, index, '展开院校与分数段', Boolean(expandedDetails[detailKey(index, year)])) +
        '<div class="aggregate-year-detail" data-year-detail="' + detailKey(index, year) + '">' +
        detailHtml(aggregate, year, Boolean(expandedDetails[detailKey(index, year)])) + '</div></section>';
    }).join('') + '</div></article>';
}

function selectedYearsLabel(years, metadata) {
  var supported = getSortedYears(metadata);
  if (!years.length) return '年份：未选择';
  if (years.length === supported.length) return '年份：全部（' + years[0] + '–' + years[years.length - 1] + '）';
  return '年份：' + years.join('、');
}

function toolbarHtml(model, metadata) {
  var cards = model.resultLayout !== 'table';
  var yearsLabel = selectedYearsLabel(model.selectedYears, metadata);
  return '<div class="result-toolbar" aria-label="结果显示设置">' +
    '<button type="button" data-result-action="years" aria-haspopup="dialog" aria-label="选择展示年份，' + esc(yearsLabel) + '">' + esc(yearsLabel) + '</button>' +
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

function tableRowsHtml(aggregates, years, expandedDetails) {
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
        '<td>' + detailButtonHtml(year, index, '查看院校详情', Boolean(expandedDetails[detailKey(index, year)])) + '</td>';
    }).join('');
    var details = years.map(function (year) {
      var expanded = Boolean(expandedDetails[detailKey(index, year)]);
      return '<tr class="aggregate-table-detail"' + (expanded ? '' : ' hidden') + '><td colspan="' + (3 + years.length * 5) + '"><div class="aggregate-year-detail" data-year-detail="' + detailKey(index, year) + '">' +
        detailHtml(aggregate, year, expanded) + '</div></td></tr>';
    }).join('');
    return '<tr class="aggregate-table-row"><td>' + esc(major.majorName || '') + '</td><td>' + esc(major.publicCourse || '—') +
      '</td><td>' + esc(course.name || '—') + '</td>' + values + '</tr>' +
      details;
  }).join('');
}

function tableHtml(model, metadata) {
  var years = model.selectedYears || getSortedYears(metadata);
  return '<div class="aggregate-table-wrap"><table class="aggregate-table">' + tableHeaderHtml(years) +
    '<tbody>' + tableRowsHtml(model.aggregates || [], years, model.expandedDetails || {}) + '</tbody></table></div>';
}

export function buildYearDialogHtml(metadata, selectedYears) {
  var years = getSortedYears(metadata);
  var selected = selectedYears || years;
  var focusYear = selected.length ? selected[selected.length - 1] : null;
  return '<dialog class="year-selection-dialog" aria-labelledby="year-selection-title">' +
    '<form method="dialog"><h2 id="year-selection-title">显示年份</h2><p class="year-selection-summary">已选 ' + selected.length + '/' + years.length + ' 年 · 当前基准：' + esc(focusYear == null ? '—' : focusYear + ' 年') + '</p><p>勾选后会同步影响筛选、预览和导出。</p>' +
    '<fieldset><legend>展示年份</legend>' + years.map(function (year) {
      return '<label><input type="checkbox" name="selected-year" value="' + year + '"' +
        (selected.indexOf(year) >= 0 ? ' checked' : '') + '> ' + year + ' 年</label>';
    }).join('') + '</fieldset><p class="year-selection-error" aria-live="polite"></p>' +
    '<div class="year-selection-actions"><button type="button" data-year-select="all">全选</button>' +
    '<button type="button" data-year-select="latest">仅最新年份</button>' +
    '<button type="submit" value="cancel">取消</button><button type="button" data-year-apply>应用</button></div></form></dialog>';
}

export function buildResultWorkspaceHtml(model, metadata) {
  var viewModel = buildResultViewModel(model, metadata);
  if (!viewModel.aggregates.length) return statusHtml(viewModel);
  var content = viewModel.resultLayout === 'table' ? tableHtml(viewModel, metadata) : '<div class="aggregate-list">' + viewModel.aggregates.map(function (aggregate, index) {
    return majorSummaryHtml(aggregate, viewModel.selectedYears, index, viewModel.expandedDetails);
  }).join('') + '</div>';
  return toolbarHtml(viewModel, metadata) + content + buildYearDialogHtml(metadata, viewModel.selectedYears);
}

export function buildExpandedYearHtml(aggregate, year) {
  var yearAggregate = aggregate && aggregate.years && aggregate.years[year];
  if (!yearAggregate) return '<div class="result-state">该年份数据尚未发布</div>';
  return '<div class="school-detail-list">' + (yearAggregate.schools || []).map(buildSchoolDetailHtml).join('') + '</div>' +
    buildScoreSegmentsHtml(yearAggregate.scoreSegments);
}

export function toggleYearDetail(root, aggregates, button, expandedDetails) {
  var majorIndex = Number(button.getAttribute('data-major-index'));
  var year = Number(button.getAttribute('data-expand-year'));
  var key = detailKey(majorIndex, year);
  var holder = root.querySelector('[data-year-detail="' + majorIndex + '-' + year + '"]');
  if (!holder || !expandedDetails) return false;
  var opening = !expandedDetails[key];
  if (opening) expandedDetails[key] = true;
  else delete expandedDetails[key];
  holder.innerHTML = opening ? buildExpandedYearHtml(aggregates[majorIndex], year) : '';
  var detailRow = typeof holder.closest === 'function' ? holder.closest('.aggregate-table-detail') : null;
  if (detailRow) detailRow.hidden = !opening;
  button.textContent = opening ? '收起详情' : (button.dataset.expandLabel || '展开院校与分数段');
  button.setAttribute('aria-expanded', String(opening));
  return opening;
}

function resultSignature(model) {
  var aggregateIds = (model.aggregates || []).map(function (aggregate) {
    var major = aggregate.major || {};
    return major.majorId || major.majorCode || major.majorName || '';
  });
  return model.selectedYears.join(',') + '|' + aggregateIds.join('|');
}

function getResultViewState(root, model) {
  var state = resultViewStates.get(root);
  var signature = resultSignature(model);
  var isTransientLoading = model.status === 'loading';
  if (!state || (!isTransientLoading && state.signature !== signature)) {
    state = { signature: signature, expandedDetails: {} };
    resultViewStates.set(root, state);
  }
  if (!isTransientLoading) state.signature = signature;
  return state;
}

function within(root, target, selector) {
  if (!target || typeof target.closest !== 'function') return null;
  var match = target.closest(selector);
  return match && root.contains(match) ? match : null;
}

function openYearDialog(root) {
  var dialog = root.querySelector('.year-selection-dialog');
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function applyYearPreset(root, metadata, preset) {
  var dialog = root.querySelector('.year-selection-dialog');
  if (!dialog) return;
  var years = getSortedYears(metadata);
  var selected = preset === 'latest' ? [years[years.length - 1]] : years;
  dialog.querySelectorAll('input[name="selected-year"]').forEach(function (input) {
    input.checked = selected.indexOf(Number(input.value)) >= 0;
  });
}

function applySelectedYears(root, dispatch) {
  var dialog = root.querySelector('.year-selection-dialog');
  if (!dialog) return;
  var years = Array.from(dialog.querySelectorAll('input[name="selected-year"]:checked')).map(function (input) {
    return Number(input.value);
  });
  var error = dialog.querySelector('.year-selection-error');
  if (!years.length) {
    if (error) error.textContent = '请至少选择一个年份。';
    return;
  }
  if (dispatch) dispatch({ type: 'SET_SELECTED_YEARS', years: years });
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function handleResultClick(root, model, metadata, dispatch, event, expandedDetails) {
  var layout = within(root, event.target, '[data-result-layout]');
  if (layout) {
    if (dispatch) dispatch({ type: 'SET_RESULT_LAYOUT', resultLayout: layout.dataset.resultLayout });
    return;
  }
  var yearAction = within(root, event.target, '[data-result-action="years"]');
  if (yearAction) {
    openYearDialog(root);
    return;
  }
  var preset = within(root, event.target, '[data-year-select]');
  if (preset) {
    applyYearPreset(root, metadata, preset.dataset.yearSelect);
    return;
  }
  var apply = within(root, event.target, '[data-year-apply]');
  if (apply) {
    applySelectedYears(root, dispatch);
    return;
  }
  var detailButton = within(root, event.target, '[data-expand-year]');
  if (detailButton) toggleYearDetail(root, model.aggregates || [], detailButton, expandedDetails);
}

export function renderResultWorkspace(root, model, metadata, dispatch) {
  var viewModel = buildResultViewModel(model, metadata);
  var viewState = getResultViewState(root, viewModel);
  viewModel = { ...viewModel, expandedDetails: viewState.expandedDetails };
  root.innerHTML = buildResultWorkspaceHtml(viewModel, metadata);
  root.onclick = function (event) {
    handleResultClick(root, viewModel, metadata, dispatch, event, viewState.expandedDetails);
  };
}
