import { nextSortDirection } from './preview.js';
import { getCollegeYears } from './metadata.js';
import { esc } from './utils.js';
import { buildExpandedMajorHtml, buildResultViewModel, buildResultWorkspaceHtml, resultMessage } from './results-view.js';

var resultStates = new WeakMap();
var resultContexts = new WeakMap();
var boundResults = new WeakSet();
var userInteractionVersion = 0;

function defaultCollegeYear(years) {
  var available = (years || []).filter(Number.isInteger);
  return available.length ? String(Math.max(...available)) : 'all';
}

if (typeof window !== 'undefined') {
  ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (eventName) {
    window.addEventListener(eventName, function () { userInteractionVersion += 1; }, { passive: eventName !== 'keydown' });
  });
}

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
    state = { signature: signature, selectedMajorKey: '', schoolLayout: 'cards',
      schoolYear: defaultCollegeYear(model.collegeYears || model.selectedYears),
      returnScrollY: null, returnMajorIndex: null, detailRequestId: 0 };
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
  var returnButton = root.querySelector('#school-detail-return');
  var yearSelect = root.querySelector('#school-year-filter');
  if (!section || !content || !state) return Promise.resolve();
  var collegeYears = context.model.collegeYears || context.model.selectedYears;
  if (yearSelect) {
    if (state.schoolYear !== 'all' && collegeYears.indexOf(Number(state.schoolYear)) < 0) {
      state.schoolYear = defaultCollegeYear(collegeYears);
    }
    yearSelect.innerHTML = '<option value="all">全部可用年份</option>' + collegeYears.map(function (year) {
      return '<option value="' + esc(year) + '">' + esc(year) + ' 年</option>';
    }).join('');
    yearSelect.value = String(state.schoolYear);
  }
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
  if (returnButton) returnButton.hidden = activeIndex < 0;
  if (activeIndex < 0) {
    state.detailRequestId += 1;
    section.removeAttribute('aria-busy');
    state.selectedMajorKey = '';
    if (title) title.textContent = '按专业查看各院校招生信息';
    content.innerHTML = '<p class="selected-major-empty">选择上方的本科专业，查看对应院校和招生计划。</p>';
    return Promise.resolve();
  }
  var aggregate = context.model.aggregates[activeIndex];
  var majorName = aggregate.major && aggregate.major.majorName || '';
  var requestId = ++state.detailRequestId;
  var schoolYears = state.schoolYear === 'all' ? collegeYears : [Number(state.schoolYear)];
  var detailPromise = context.onExpand
    ? Promise.resolve().then(function () {
      return context.onExpand(aggregate, context.model.selectedYears, context.model.hiddenFields, schoolYears);
    })
    : Promise.resolve({ html: buildExpandedMajorHtml(aggregate, context.model.selectedYears, context.model.hiddenFields, schoolYears) });
  section.setAttribute('aria-busy', 'true');
  return detailPromise.catch(function (error) {
    return { error: error.message || String(error) };
  }).then(function (detail) {
    if (state.detailRequestId !== requestId || state.selectedMajorKey !== detailKey(aggregate)) return;
    var holder = document.createElement('div');
    holder.className = 'selected-major-detail';
    holder.dataset.majorDetail = String(activeIndex);
    if (detail && detail.error) holder.textContent = '数据加载失败：' + detail.error;
    else holder.innerHTML = detail && detail.html || '';
    if (title) title.textContent = majorName;
    content.replaceChildren(holder);
    section.removeAttribute('aria-busy');
  });
}

function selectMajor(root, context, button) {
  var aggregate = context.model.aggregates[Number(button.dataset.selectMajor)];
  if (!aggregate) return;
  var key = detailKey(aggregate);
  var isDeselecting = context.state.selectedMajorKey === key;
  var clickScrollY = window.scrollY;
  var interactionVersion = userInteractionVersion;
  if (isDeselecting) {
    context.state.selectedMajorKey = '';
    context.state.returnScrollY = null;
    context.state.returnMajorIndex = null;
  } else {
    context.state.returnScrollY = window.scrollY;
    context.state.returnMajorIndex = button.dataset.selectMajor;
    context.state.selectedMajorKey = key;
  }
  var detailsReady = renderSelectedMajor(root, context);
  var requestId = context.state.detailRequestId;
  if (!isDeselecting && window.matchMedia('(max-width: 600px)').matches) {
    detailsReady.then(function () {
      if (context.state.detailRequestId !== requestId || context.state.selectedMajorKey !== key) return;
      requestAnimationFrame(function () {
        var section = root.querySelector('#selected-major-section');
        if (!section || context.state.detailRequestId !== requestId || context.state.selectedMajorKey !== key) return;
        var behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
        section.scrollIntoView({ behavior: behavior, block: 'start' });
        section.focus({ preventScroll: true });
      });
    });
  } else if (!isDeselecting) {
    detailsReady.then(function () {
      if (context.state.detailRequestId !== requestId || context.state.selectedMajorKey !== key ||
          userInteractionVersion !== interactionVersion) return;
      requestAnimationFrame(function () {
        if (context.state.detailRequestId === requestId && context.state.selectedMajorKey === key &&
            userInteractionVersion === interactionVersion) window.scrollTo(0, clickScrollY);
      });
    });
  }
}

function returnToResults(root, context) {
  var state = context.state;
  if (!state || state.returnScrollY == null) return;
  var scrollY = state.returnScrollY;
  var majorIndex = state.returnMajorIndex;
  state.selectedMajorKey = '';
  state.returnScrollY = null;
  state.returnMajorIndex = null;
  renderSelectedMajor(root, context);
  requestAnimationFrame(function () {
    var behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    window.scrollTo({ top: scrollY, behavior: behavior });
    var trigger = majorIndex == null ? null : root.querySelector('[data-select-major="' + majorIndex + '"]');
    if (trigger) trigger.focus({ preventScroll: true });
  });
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
  var returnButton = within(root, event.target, '#school-detail-return');
  if (returnButton) {
    returnToResults(root, context);
    return;
  }
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
  root.addEventListener('change', function (event) {
    var context = resultContexts.get(root);
    if (!context || !event.target || event.target.id !== 'school-year-filter') return;
    context.state.schoolYear = event.target.value;
    renderSelectedMajor(root, context);
  });
  boundResults.add(root);
}

export function setResultState(root, message, kind) {
  if (!root) return;
  var state = root.querySelector('#result-state');
  var content = root.querySelector('#result-content');
  var toolbar = root.querySelector('#result-toolbar');
  var schoolSection = root.parentElement && root.parentElement.querySelector('#selected-major-section');
  var queryView = root.closest('#view-query');
  var returnButton = queryView && queryView.querySelector('#school-detail-return');
  root.querySelectorAll('[data-result-layout]').forEach(function (button) { button.disabled = true; });
  var exportButton = root.querySelector('#exportCsv');
  if (exportButton) exportButton.disabled = true;
  root.classList.remove('has-results');
  if (toolbar) toolbar.hidden = true;
  if (content) content.hidden = true;
  if (schoolSection) schoolSection.hidden = true;
  if (returnButton) returnButton.hidden = true;
  if (state) {
    state.hidden = false;
    state.className = 'result-state ' + (kind === 'error' ? 'result-error' : 'empty');
    state.textContent = message || '';
  }
}

export function renderResultWorkspace(root, model, metadata, dispatch, onExpand) {
  if (!root) return;
  var viewModel = buildResultViewModel(model, metadata);
  viewModel.collegeYears = getCollegeYears(metadata);
  var state = resultStateFor(root, viewModel);
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
    var returnButton = interactionRoot.querySelector('#school-detail-return');
    if (returnButton) returnButton.hidden = true;
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
