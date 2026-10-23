var FIELD_TYPES = { string: true, number: true, enum: true, boolean: true };

export function getSortedYears(metadata) {
  return (metadata && Array.isArray(metadata.supportedYears) ? metadata.supportedYears : [])
    .slice().sort(function (a, b) { return a - b; });
}

export function getLatestYear(metadata) {
  var years = getSortedYears(metadata);
  return years.length ? years[years.length - 1] : null;
}

export function getPreviousYear(metadata) {
  var years = getSortedYears(metadata);
  return years.length > 1 ? years[years.length - 2] : null;
}

export function normalizeSelectedYears(years, metadata) {
  var supported = getSortedYears(metadata);
  if (!Array.isArray(years)) return supported;
  var selected = {};
  years.forEach(function (year) {
    if (supported.indexOf(year) >= 0) selected[year] = true;
  });
  return supported.filter(function (year) { return selected[year]; });
}

export function getFocusYear(selectedYears, metadata) {
  var years = normalizeSelectedYears(selectedYears, metadata);
  return years.length ? years[years.length - 1] : null;
}

function replaceMetadataTokens(value, metadata) {
  if (typeof value === 'string') {
    return value
      .replace(/\{latestYear\}/g, String(getLatestYear(metadata) || ''))
      .replace(/\{previousYear\}/g, String(getPreviousYear(metadata) || ''));
  }
  if (Array.isArray(value)) return value.map(function (item) { return replaceMetadataTokens(item, metadata); });
  if (value && typeof value === 'object') {
    var output = {};
    Object.keys(value).forEach(function (key) { output[key] = replaceMetadataTokens(value[key], metadata); });
    return output;
  }
  return value;
}

function replaceYearTokens(value, year) {
  if (typeof value === 'string') return value.replace(/\{year\}/g, String(year));
  if (Array.isArray(value)) return value.map(function (item) { return replaceYearTokens(item, year); });
  if (value && typeof value === 'object') {
    var output = {};
    Object.keys(value).forEach(function (key) { output[key] = replaceYearTokens(value[key], year); });
    return output;
  }
  return value;
}

export function expandMetadata(metadata) {
  var expanded = { ...metadata };
  expanded.supportedYears = getSortedYears(metadata);
  expanded.latestYear = getLatestYear(metadata);
  expanded.previousYear = getPreviousYear(metadata);
  expanded.yearSources = { ...(metadata.yearSources || {}) };
  expanded.fields = (metadata.fields || []).map(function (field) { return replaceMetadataTokens(field, metadata); });
  expanded.defaultSort = replaceMetadataTokens(metadata.defaultSort, metadata);
  (metadata.yearFieldTemplates || []).forEach(function (template) {
    expanded.supportedYears.forEach(function (year) {
      expanded.fields.push(replaceMetadataTokens(replaceYearTokens(template, year), metadata));
    });
  });
  return expanded;
}

/* 枚举字段的全部可选项（含「全部」） */
export function enumOptions(field) {
  return ['全部'].concat(field.enumValues || []);
}

/* 筛选默认值：枚举字段取 metadata 声明的 filterDefault，其余为空串 */
export function filterDefaultValue(field) {
  if (field.type === 'enum') {
    return enumOptions(field).indexOf(field.filterDefault) >= 0 ? field.filterDefault : '全部';
  }
  return '';
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateMetadata(value) {
  var errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['元数据必须是对象'] };
  }

  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    errors.push('schemaVersion 必须是正整数');
  }

  var years = Array.isArray(value.supportedYears) ? value.supportedYears : [];
  if (!years.length || years.some(function (year) { return !Number.isInteger(year); })) {
    errors.push('supportedYears 必须包含至少一个整数年份');
  }
  if (!years.includes(value.defaultYear)) {
    errors.push('默认年份 ' + value.defaultYear + ' 不在 supportedYears 中');
  }
  if (value.uiDefaults != null) {
    var uiDefaults = value.uiDefaults;
    if (!uiDefaults || typeof uiDefaults !== 'object' || Array.isArray(uiDefaults)) {
      errors.push('uiDefaults 必须是对象');
    } else {
      if (uiDefaults.selectedYears != null && uiDefaults.selectedYears !== 'allSupportedYears') {
        errors.push('uiDefaults.selectedYears 仅支持 allSupportedYears');
      }
      if (uiDefaults.resultLayout != null && ['cards', 'table'].indexOf(uiDefaults.resultLayout) < 0) {
        errors.push('uiDefaults.resultLayout 必须是 cards 或 table');
      }
    }
  }

  var yearSources = value.yearSources && typeof value.yearSources === 'object' ? value.yearSources : {};
  years.forEach(function (year) {
    var source = yearSources[year];
    ['mappingSource', 'scoreSource', 'planSource'].forEach(function (key) {
      if (!source || !isNonEmptyString(source[key])) errors.push(year + ' 年缺少 ' + key);
    });
    if (source && source.collegeFallbackSource != null && !isNonEmptyString(source.collegeFallbackSource)) {
      errors.push(year + ' 年 collegeFallbackSource 必须是非空路径');
    }
    if (value.schemaVersion >= 2 && (!source || !isNonEmptyString(source.scoreSegmentSource))) {
      errors.push(year + ' 年缺少 scoreSegmentSource');
    }
  });

  var fields = expandMetadata(value).fields;
  if (!fields.length) errors.push('fields 必须包含至少一个字段');
  var seen = {};
  fields.forEach(function (field, index) {
    var prefix = '字段 #' + (index + 1);
    if (!field || typeof field !== 'object') {
      errors.push(prefix + ' 必须是对象');
      return;
    }
    if (!isNonEmptyString(field.key)) errors.push(prefix + ' 缺少 key');
    else if (seen[field.key]) errors.push('字段 key 重复：' + field.key);
    else seen[field.key] = true;
    if (!isNonEmptyString(field.label)) errors.push(prefix + ' 缺少 label');
    if (!isNonEmptyString(field.exportLabel)) errors.push(prefix + ' 缺少 exportLabel');
    if (!FIELD_TYPES[field.type]) errors.push(prefix + ' type 无效');
    ['filterEnable', 'sortEnable', 'tableShow', 'exportEnable'].forEach(function (flag) {
      if (typeof field[flag] !== 'boolean') errors.push(prefix + ' 缺少布尔开关 ' + flag);
    });
    if (field.type === 'enum' && (!Array.isArray(field.enumValues) || !field.enumValues.length)) {
      errors.push((field.key || prefix) + ' 缺少 enumValues');
    }
    if (field.filterDefault != null && field.type !== 'enum') {
      errors.push((field.key || prefix) + ' filterDefault 仅适用于 enum 字段');
    }
    if (field.type === 'enum' && field.filterDefault != null &&
        enumOptions(field).indexOf(field.filterDefault) < 0) {
      errors.push((field.key || prefix) + ' filterDefault 必须是「全部」或 enumValues 之一');
    }
    if (field.type === 'number') {
      if (field.min != null && !Number.isFinite(field.min)) errors.push((field.key || prefix) + ' min 必须是数字');
      if (field.max != null && !Number.isFinite(field.max)) errors.push((field.key || prefix) + ' max 必须是数字');
      if (Number.isFinite(field.min) && Number.isFinite(field.max) && field.min > field.max) {
        errors.push((field.key || prefix) + ' 数值范围无效：min 大于 max');
      }
    }
  });

  if (!fields.some(function (field) { return field && field.exportEnable === true; })) {
    errors.push('必须配置至少一个导出字段');
  }
  var defaultSort = expandMetadata(value).defaultSort;
  var sortField = defaultSort && fields.find(function (field) { return field.key === defaultSort.key; });
  if (!defaultSort || !sortField || !sortField.sortEnable) {
    errors.push('默认排序字段 ' + (defaultSort && defaultSort.key) + ' 不存在或未启用排序');
  } else if (!['asc', 'desc', 'original'].includes(defaultSort.direction)) {
    errors.push('默认排序方向无效');
  }

  if (!Number.isInteger(value.pageSize) || value.pageSize < 1) errors.push('pageSize 必须是正整数');
  if (value.exportFormat !== 'csv') errors.push('exportFormat 当前仅支持 csv');

  return { valid: errors.length === 0, errors: errors };
}

export async function loadMetadata(url, fetchImpl) {
  var fetcher = fetchImpl || fetch;
  var response;
  try {
    response = await fetcher(url, { cache: 'no-store' });
  } catch (error) {
    throw new Error(url + ' 加载失败：' + error.message);
  }
  if (!response.ok) throw new Error(url + ' 加载失败（HTTP ' + response.status + '）');
  var value;
  try {
    value = await response.json();
  } catch (error) {
    throw new Error(url + ' 解析失败：' + error.message);
  }
  var result = validateMetadata(value);
  if (!result.valid) throw new Error('元数据无效：' + result.errors.join('；'));
  return expandMetadata(value);
}
