/* Specialty search. Each controller owns its selected year and result callback. */
import { getSelectableYears } from './metadata.js';
import { setResultState } from './results-controller.js';

export function findMappingMatches(mapping, keyword) {
  var kw = String(keyword || '').trim();
  return (mapping || []).filter(function (item) { return String(item['专科专业'] || '').indexOf(kw) > -1; });
}

export function resolveMappingMatch(mapping, keyword) {
  var kw = String(keyword || '').trim();
  var matches = findMappingMatches(mapping, kw);
  return matches.find(function (item) { return String(item['专科专业'] || '').trim() === kw; }) || matches[0] || null;
}

export function createQueryController(data, options) {
  options = options || {};
  var metadata = options.metadata || {};
  var onResult = options.onResult;
  var queryYear = metadata.defaultYear;

  function selectedYear() {
    return getSelectableYears(metadata).includes(queryYear) ? queryYear : metadata.defaultYear;
  }

  function mappingYear() {
    return Number.isInteger(metadata.queryMappingYear) ? metadata.queryMappingYear : selectedYear();
  }

  function currentMapping() { return data.getMapping(selectedYear()); }

  function emitResult(majors, specialtyName) {
    if (typeof onResult === 'function') onResult(majors, specialtyName);
  }

  function fillSuggest(suggest, keyword) {
    suggest.innerHTML = '';
    var mapping = currentMapping();
    if (!keyword || !data.hasQueryIndex(selectedYear())) return;
    var count = 0;
    mapping.forEach(function (item) {
      var name = item['专科专业'];
      if (name.indexOf(keyword) > -1 && count < 30) {
        var option = document.createElement('option');
        option.value = name;
        suggest.appendChild(option);
        count += 1;
      }
    });
  }

  function showSpecialty(input, hint, result, specialty) {
    if (!specialty) return;
    input.value = specialty['专科专业'];
    var majors = specialty['可报本科专业'] || [];
    emitResult(majors, specialty['专科专业']);
    hint.textContent = specialty['专科专业'] + ' · 共 ' + majors.length + ' 个可报本科专业（' +
      (mappingYear() || '') + ' 对照一览表）';
    if (!majors.length) setResultState(result, '「' + specialty['专科专业'] + '」暂无可报本科专业数据', 'empty');
  }

  function doQuery(input, hint, result) {
    if (!data.hasQueryIndex(selectedYear())) return;
    var keyword = (input.value || '').trim();
    if (!keyword) {
      hint.textContent = '';
      emitResult([], '');
      setResultState(result, '输入专科专业，回车或点击查询开始检索', 'empty');
      return;
    }

    var mapping = currentMapping();
    var matches = findMappingMatches(mapping, keyword);
    if (!matches.length) {
      hint.textContent = '';
      emitResult([], '');
      setResultState(result, '未找到专科专业「' + keyword + '」。可尝试输入关键词的一部分（如「物联网」）；本工具收录 ' +
        (mappingYear() || '') + ' 年对照一览表中的 ' + mapping.length + ' 个专科专业。', 'empty');
      return;
    }
    showSpecialty(input, hint, result, resolveMappingMatch(mapping, keyword));
  }

  return {
    setYear: function (year) { queryYear = Number.isInteger(year) ? year : metadata.defaultYear; },
    fillSuggest: fillSuggest,
    doQuery: doQuery
  };
}

export function bindQueryControls(options) {
  var input = options.input;
  var suggest = options.suggest;
  var hint = options.hint;
  var result = options.result;
  var clearButton = options.clearButton;
  var getController = options.getController;
  function run() {
    var controller = getController();
    if (controller) controller.doQuery(input, hint, result);
  }

  input.addEventListener('input', function () {
    var controller = getController();
    if (controller) controller.fillSuggest(suggest, input.value.trim());
    clearButton.style.display = input.value ? 'inline-block' : 'none';
  });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') run();
  });
  options.goButton.addEventListener('click', run);
  clearButton.addEventListener('click', function () {
    input.value = '';
    input.focus();
    clearButton.style.display = 'none';
    run();
  });
}
