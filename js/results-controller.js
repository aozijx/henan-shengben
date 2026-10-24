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
    state = { signature: signature, expandedDetails: {}, selectedMajorKey: '', schoolLayout: 'cards' };
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

function renderSelectedMajor(root, context) {
  var state = context.state;
  var section = root.querySelector('#selected-major-section');
  var title = root.querySelector('#selected-major-name');
  var content = root.querySelector('#selected-major-content');
  if (!section || !content || !state) return;
  section.dataset.schoolLayout = state.schoolLayout;
  root.querySelectorAll('[data-select-major]').forEach(function (button) {
    var aggregate = context.model.aggregates[Number(button.dataset.selectMajor)];
    var selected = Boolean(aggregate && detailKey(aggregate) === state.selectedMajorKey);
    button.setAttribute('aria-pressed', String(selected));
    button.textContent = selected ? '当前院校' : '查看院校';
  });
  root.querySelectorAll('button[data-school-layout]').forEach(function (button) {
    button.setAttribute('aria-pressed', String(button.dataset.schoolLayout === state.schoolLayout));
  });
  var activeIndex = context.model.aggregates.findIndex(function (aggregate) {
    return detailKey(aggregate) === state.selectedMajorKey;
  });
  if (activeIndex < 0) {
    state.selectedMajorKey = '';
    if (title) title.textContent = '按专业查看各院校招生信息';
    content.innerHTML = '<p class="selected-major-empty">选择上方的本科专业，查看对应院校和招生计划。</p>';
    return;
  }
  var aggregate = context.model.aggregates[activeIndex];
  if (title) title.textContent = aggregate.major && aggregate.major.majorName || '';
  var holder = document.createElement('div');
  holder.className = 'selected-major-detail';
  holder.dataset.majorDetail = String(activeIndex);
  holder.innerHTML = buildExpandedMajorHtml(aggregate, context.model.selectedYears, context.model.hiddenFields);
  content.replaceChildren(holder);
  if (context.onExpand) context.onExpand(aggregate, context.model.selectedYears, holder, context.model.hiddenFields);
}

function selectMajor(root, context, button) {
  var aggregate = context.model.aggregates[Number(button.dataset.selectMajor)];
  if (!aggregate) return;
  var key = detailKey(aggregate);
  context.state.selectedMajorKey = context.state.selectedMajorKey === key ? '' : key;
  renderSelectedMajor(root, context);
}

function setSchoolLayout(root, context, button) {
  var layout = button.dataset.schoolLayout;
  if (layout !== 'cards' && layout !== 'list') return;
  context.state.schoolLayout = layout;
  var section = root.querySelector('#selected-major-section');
  if (section) section.dataset.schoolLayout = layout;
  root.querySelectorAll('button[data-school-layout]').forEach(function (item) {
    item.setAttribute('aria-pressed', String(item.dataset.schoolLayout === layout));
  });
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
  var schoolLayout = within(root, event.target, '[data-school-layout]');
  if (schoolLayout) {
    setSchoolLayout(root, context, schoolLayout);
    return;
  }
  var majorButton = within(root, event.target, '[data-select-major]');
  if (majorButton) selectMajor(root, context, majorButton);
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
  var schoolSection = root.parentElement && root.parentElement.querySelector('#selected-major-section');
  root.querySelectorAll('[data-result-layout]').forEach(function (button) { button.disabled = true; });
  var exportButton = root.querySelector('#exportCsv');
  if (exportButton) exportButton.disabled = true;
  root.classList.remove('has-results');
  if (toolbar) toolbar.hidden = true;
  if (content) content.hidden = true;
  if (schoolSection) schoolSection.hidden = true;
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
  var interactionRoot = root.closest('#view-query') || root;
  var schoolSection = interactionRoot.querySelector('#selected-major-section');
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
    if (schoolSection) schoolSection.hidden = true;
    resultContexts.set(interactionRoot, { model: viewModel, dispatch: dispatch, onExpand: onExpand, state: state });
    bindResultEvents(interactionRoot);
    return;
  }
  if (schoolSection) schoolSection.hidden = false;
  viewModel.selectedMajorKey = state.selectedMajorKey;
  viewModel.schoolLayout = state.schoolLayout;
  var context = { model: viewModel, dispatch: dispatch, onExpand: onExpand, state: state };
  if (content) content.innerHTML = buildResultWorkspaceHtml(viewModel, metadata);
  resultContexts.set(interactionRoot, context);
  bindResultEvents(interactionRoot);
  if (content && onExpand) {
    renderSelectedMajor(interactionRoot, context);
  }
}
