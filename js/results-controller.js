import { nextSortDirection } from './preview.js';
import { buildExpandedMajorHtml, buildResultViewModel, buildResultWorkspaceHtml, resultMessage } from './results-view.js';

var resultStates = new WeakMap();
var resultContexts = new WeakMap();
var boundResults = new WeakSet();

function resultSignature(model) {
  var majorKeys = model.aggregates.map(function (aggregate) {
    var major = aggregate.major || {};
    return major.majorId || major.majorCode || major.majorName || '';
  }).sort();
  return model.selectedYears.join(',') + '|' + majorKeys.join('|');
}

function detailKey(aggregate) {
  var major = aggregate && aggregate.major || {};
  return String(major.majorId || major.majorCode || major.majorName || '');
}

function resultStateFor(root, model) {
  var state = resultStates.get(root);
  var signature = resultSignature(model);
  if (!state || (model.status !== 'loading' && state.signature !== signature)) {
    state = { signature: signature, expandedDetails: {} };
    resultStates.set(root, state);
  }
  if (model.status !== 'loading') state.signature = signature;
  return state;
}

function within(root, target, selector) {
  if (!target || typeof target.closest !== 'function') return null;
  var match = target.closest(selector);
  return match && root.contains(match) ? match : null;
}

function toggleMajorDetail(root, context, button) {
  var index = Number(button.getAttribute('data-expand-major'));
  var aggregate = context.model.aggregates[index];
  var key = detailKey(aggregate);
  var holder = root.querySelector('[data-major-detail="' + index + '"]');
  if (!holder || !context.expandedDetails) return false;
  var opening = !context.expandedDetails[key];
  if (opening) context.expandedDetails[key] = true;
  else delete context.expandedDetails[key];
  holder.hidden = !opening;
  holder.innerHTML = opening
    ? buildExpandedMajorHtml(aggregate, context.model.selectedYears, context.model.hiddenFields)
    : '';
  var detailRow = holder.closest('.aggregate-table-detail');
  if (detailRow) detailRow.hidden = !opening;
  button.textContent = opening ? '收起院校详情' : (button.dataset.expandLabel || '查看院校详情');
  button.setAttribute('aria-expanded', String(opening));
  if (opening && context.onExpand) context.onExpand(aggregate, context.model.selectedYears, holder, context.model.hiddenFields);
  return opening;
}

function handleResultClick(root, event) {
  var context = resultContexts.get(root);
  if (!context) return;
  var sort = within(root, event.target, '[data-result-sort]');
  if (sort && context.dispatch) {
    var key = sort.dataset.resultSort;
    context.dispatch({ type: 'SET_SORT', sort: { key: key, direction: nextSortDirection(context.model.sort, key) } });
    return;
  }
  var layout = within(root, event.target, '[data-result-layout]');
  if (layout && context.dispatch) {
    context.dispatch({ type: 'SET_RESULT_LAYOUT', resultLayout: layout.dataset.resultLayout });
    return;
  }
  var detailButton = within(root, event.target, '[data-expand-major]');
  if (detailButton) toggleMajorDetail(root, context, detailButton);
}

function bindResultEvents(root) {
  if (boundResults.has(root)) return;
  root.addEventListener('click', function (event) { handleResultClick(root, event); });
  boundResults.add(root);
}

export function setResultState(root, message, kind) {
  if (!root) return;
  var state = root.querySelector('#result-state');
  var content = root.querySelector('#result-content');
  var toolbar = root.querySelector('#result-toolbar');
  root.querySelectorAll('[data-result-layout]').forEach(function (button) { button.disabled = true; });
  var exportButton = root.querySelector('#exportCsv');
  if (exportButton) exportButton.disabled = true;
  root.classList.remove('has-results');
  if (toolbar) toolbar.hidden = true;
  if (content) content.hidden = true;
  if (state) {
    state.hidden = false;
    state.className = 'result-state ' + (kind === 'error' ? 'result-error' : 'empty');
    state.textContent = message || '';
  }
}

export function renderResultWorkspace(root, model, metadata, dispatch, onExpand) {
  if (!root) return;
  var viewModel = buildResultViewModel(model, metadata);
  var state = resultStateFor(root, viewModel);
  viewModel = { ...viewModel, expandedDetails: state.expandedDetails };
  var hasResults = viewModel.status === 'ready' && viewModel.aggregates.length > 0;
  var status = root.querySelector('#result-state');
  var content = root.querySelector('#result-content');
  var toolbar = root.querySelector('#result-toolbar');
  root.querySelectorAll('[data-result-layout]').forEach(function (button) {
    button.disabled = !hasResults;
    if (hasResults) button.setAttribute('aria-pressed', String(button.dataset.resultLayout === viewModel.resultLayout));
  });
  var exportButton = root.querySelector('#exportCsv');
  if (exportButton) exportButton.disabled = !hasResults;
  root.classList.toggle('has-results', hasResults);
  if (toolbar) toolbar.hidden = !hasResults;
  if (content) content.hidden = !hasResults;
  if (status) {
    status.hidden = hasResults;
    status.className = 'result-state ' + (viewModel.status === 'error' ? 'result-error' : 'empty');
    status.textContent = resultMessage(viewModel);
  }
  if (!hasResults) {
    resultContexts.set(root, { model: viewModel, dispatch: dispatch, onExpand: onExpand, expandedDetails: state.expandedDetails });
    bindResultEvents(root);
    return;
  }
  var context = { model: viewModel, dispatch: dispatch, onExpand: onExpand, expandedDetails: state.expandedDetails };
  if (content) content.innerHTML = buildResultWorkspaceHtml(viewModel, metadata);
  resultContexts.set(root, context);
  bindResultEvents(root);
  if (content && onExpand) {
    viewModel.aggregates.forEach(function (aggregate, index) {
      if (!state.expandedDetails[detailKey(aggregate)]) return;
      var holder = root.querySelector('[data-major-detail="' + index + '"]');
      if (holder) onExpand(aggregate, viewModel.selectedYears, holder, viewModel.hiddenFields);
    });
  }
}
