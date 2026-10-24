import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv from 'ajv';
import { validateMetadata } from '../js/metadata.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadJson(relativePath) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'));
}

function loadSchema(name) {
  return loadJson(join('metadata', name));
}

function loadDataSchema(name) {
  return loadJson(join('data', 'schemas', name));
}

function formatAjvErrors(errors) {
  return (errors || []).map(function (err) {
    return (err.instancePath || '') + ' ' + (err.message || '');
  }).join('；');
}

test('school-data.json passes its JSON Schema', () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(loadSchema('school-data.schema.json'));
  const metadata = loadJson('metadata/school-data.json');
  const ok = validate(metadata);
  assert.ok(ok, formatAjvErrors(validate.errors));
});

test('schema v3 rejects a yearly analytics source omission', () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(loadSchema('school-data.schema.json'));
  const metadata = loadJson('metadata/school-data.json');
  delete metadata.yearSources[2026].analyticsSource;
  assert.equal(validate(metadata), false);
});

test('school-data.json passes runtime validateMetadata', () => {
  const metadata = loadJson('metadata/school-data.json');
  const result = validateMetadata(metadata);
  assert.deepEqual(result, { valid: true, errors: [] }, result.errors.join('；'));
});

test('all metadata sources resolve inside typed data directories', () => {
  const metadata = loadJson('metadata/school-data.json');
  const failures = [];
  const catalog = loadJson(metadata.catalogSource);
  assert.deepEqual(catalog.supportedYears, metadata.supportedYears);
  assert.deepEqual(catalog.yearSources, metadata.yearSources);

  Object.entries(metadata.yearSources).forEach(function ([year, sources]) {
    Object.entries(sources).forEach(function ([role, relativePath]) {
      if (role === 'mappingReferenceYear') return;
      const normalized = relativePath.replace(/\\/g, '/');
      const parts = normalized.split('/');
      if (parts[0] !== 'data' || parts.length < 3) {
        failures.push(year + ' ' + role + ' 未位于 data 类型子目录：' + relativePath);
      } else if (!existsSync(join(ROOT, relativePath.replace('{majorCode}',
        JSON.parse(readFileSync(join(ROOT, sources.scoreSegmentIndexSource), 'utf8')).majors[0]?.majorCode || ''))) ) {
        failures.push(year + ' ' + role + ' 文件不存在：' + relativePath);
      }
    });
  });

  assert.deepEqual(failures, [], failures.join('\n'));
});

test('every indexed score segment shard matches its year, code and cumulative counts', () => {
  const metadata = loadJson('metadata/school-data.json');
  Object.entries(metadata.yearSources).forEach(function ([year, sources]) {
    const index = loadJson(sources.scoreSegmentIndexSource);
    const canonical = loadJson(sources.scoreSegmentSource);
    assert.equal(index.year, Number(year));
    assert.equal(index.majors.length, canonical.majors.length);
    index.majors.forEach(function (entry) {
      const shard = loadJson('data/' + entry.path);
      const originalEntry = canonical.majors.find(function (major) { return major.majorCode === entry.majorCode; });
      assert.ok(originalEntry, year + '/' + entry.majorCode + ' missing from canonical source');
      const original = loadJson('data/' + originalEntry.path);
      assert.equal(shard.majorCode, entry.majorCode);
      assert.deepEqual(shard.segments.map(function (segment) { return segment.cumulativeCount; }),
        original.segments.map(function (segment) { return segment.cumulativeCount; }));
    });
  });
});

test('all data files pass their JSON Schemas', () => {
  const files = [
    ['scores.schema.json', 'data/省控线/省控线_2024.json'],
    ['scores.schema.json', 'data/省控线/省控线_2025.json'],
    ['scores.schema.json', 'data/省控线/省控线_2026.json'],
    ['plans.schema.json', 'data/招生计划/招生计划_2024.json'],
    ['plans.schema.json', 'data/招生计划/招生计划_2025.json'],
    ['plans.schema.json', 'data/招生计划/招生计划_2026.json'],
    ['mapping.schema.json', 'data/专业对照/专业对照_2026.json'],
    ['colleges.schema.json', 'data/招生高校及专业/招生高校及专业_2026.json']
  ];
  const failures = [];
  files.forEach(function (pair) {
    const schemaName = pair[0];
    const dataPath = pair[1];
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(loadSchema(schemaName));
    const data = loadJson(dataPath);
    const ok = validate(data);
    if (!ok) {
      failures.push(dataPath + ': ' + formatAjvErrors(validate.errors));
    }
  });
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('mapping entries have unique (专科专业, 本科专业名称, 代码6位)', () => {
  const mapping = loadJson('data/专业对照/专业对照_2026.json');
  const seen = new Set();
  const duplicates = [];
  mapping.forEach(function (group) {
    const major = group['专科专业'];
    (group['可报本科专业'] || []).forEach(function (item) {
      const key = major + '|' + item['专业名称'] + '|' + item['代码6位'];
      if (seen.has(key)) duplicates.push(key);
      else seen.add(key);
    });
  });
  assert.deepEqual(duplicates, [], '重复条目：' + duplicates.join('；'));
});

test('score professional codes are non-empty for every year', () => {
  const years = ['2024', '2025', '2026'];
  const failures = [];
  years.forEach(function (year) {
    const scores = loadJson('data/省控线/省控线_' + year + '.json');
    scores.forEach(function (row, index) {
      if (!row['专业代号'] || !String(row['专业代号']).trim()) {
        failures.push('分数线' + year + ' 第' + (index + 1) + '行专业代号缺失：' + row['专业名称']);
      }
    });
  });
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('normalized score segment files and source manifests pass their schemas', () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const scoreValidate = ajv.compile(loadDataSchema('score-segments.schema.json'));
  const shardValidate = ajv.compile(loadDataSchema('score-segment-shard.schema.json'));
  const manifestValidate = ajv.compile(loadDataSchema('source-manifest.schema.json'));
  const failures = [];
  ['2024', '2025', '2026'].forEach(function (year) {
    const scorePath = 'data/一分一段/一分一段_' + year + '.json';
    if (!scoreValidate(loadJson(scorePath))) {
      failures.push(scorePath + ': ' + formatAjvErrors(scoreValidate.errors));
    }
    const index = loadJson(scorePath);
    index.majors.forEach(function (entry) {
      const shardPath = 'data/' + entry.path;
      if (!shardValidate(loadJson(shardPath))) {
        failures.push(shardPath + ': ' + formatAjvErrors(shardValidate.errors));
      }
    });
    const manifestPath = 'data/来源清单/来源清单_' + year + '.json';
    if (!manifestValidate(loadJson(manifestPath))) {
      failures.push(manifestPath + ': ' + formatAjvErrors(manifestValidate.errors));
    }
  });
  assert.deepEqual(failures, [], failures.join('\n'));
});
