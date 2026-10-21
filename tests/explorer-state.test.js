import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, reduceExplorerState, sanitizeNumberInput } from '../js/explorer.js';

const metadata = {
  defaultYear: 2026,
  defaultSort: { key: 'originalOrder', direction: 'original' },
  fields: [
    { key: 'schoolType', type: 'enum', filterEnable: true },
    { key: 'povertyStatus', type: 'enum', filterEnable: true },
    { key: 'subject', type: 'enum', filterEnable: true },
    { key: 'schoolCount', type: 'number', filterEnable: true }
  ]
};

test('creates a loading state from metadata defaults', () => {
  const state = createInitialState(metadata);
  assert.equal(state.status, 'loading');
  assert.equal(state.year, 2026);
  assert.deepEqual(state.sort, metadata.defaultSort);
  assert.deepEqual(state.filters, { schoolType: '全部', povertyStatus: '全部', subject: '全部', schoolCount: '' });
  assert.equal(state.page, 1);
});

test('year changes preserve search but reset page', () => {
  const state = { ...createInitialState(metadata), status: 'ready', page: 3, majors: [{ 专业名称: '软件工程' }] };
  const next = reduceExplorerState(state, { type: 'SET_YEAR', year: 2025 }, metadata);
  assert.equal(next.year, 2025);
  assert.equal(next.page, 1);
  assert.equal(next.majors.length, 1);
});

test('filter and sort changes reset pagination', () => {
  let state = { ...createInitialState(metadata), status: 'ready', page: 4 };
  state = reduceExplorerState(state, { type: 'SET_FILTER', key: 'schoolType', value: '民办' }, metadata);
  assert.equal(state.filters.schoolType, '民办');
  assert.equal(state.page, 1);
  state = { ...state, page: 2 };
  state = reduceExplorerState(state, { type: 'SET_SORT', sort: { key: 'score', direction: 'desc' } }, metadata);
  assert.deepEqual(state.sort, { key: 'score', direction: 'desc' });
  assert.equal(state.page, 1);
});

test('reset restores filters and default sort while retaining year and search', () => {
  const changed = {
    ...createInitialState(metadata),
    year: 2025,
    majors: [{ 专业名称: '英语' }],
    specName: '商务英语',
    filters: { schoolType: '民办', povertyStatus: '是', subject: '管理学', schoolCount: '3' },
    sort: { key: 'score', direction: 'desc' },
    page: 3
  };
  const reset = reduceExplorerState(changed, { type: 'RESET_FILTERS' }, metadata);
  assert.equal(reset.year, 2025);
  assert.equal(reset.specName, '商务英语');
  assert.equal(reset.majors.length, 1);
  assert.deepEqual(reset.filters, { schoolType: '全部', povertyStatus: '全部', subject: '全部', schoolCount: '' });
  assert.deepEqual(reset.sort, metadata.defaultSort);
  assert.equal(reset.page, 1);
});

test('loading success and failure states are explicit', () => {
  const loading = createInitialState(metadata);
  const ready = reduceExplorerState(loading, { type: 'LOAD_SUCCESS' }, metadata);
  assert.equal(ready.status, 'ready');
  const failed = reduceExplorerState(loading, { type: 'LOAD_ERROR', error: 'metadata 无效' }, metadata);
  assert.equal(failed.status, 'error');
  assert.equal(failed.error, 'metadata 无效');
});

test('search result replacement resets the page', () => {
  const state = { ...createInitialState(metadata), page: 3 };
  const next = reduceExplorerState(state, {
    type: 'SET_SEARCH_RESULT', majors: [{ 专业名称: '软件工程' }], specName: '软件技术'
  }, metadata);
  assert.equal(next.specName, '软件技术');
  assert.equal(next.page, 1);
});

test('number input sanitizer blocks letters, punctuation and negative signs', () => {
  assert.equal(sanitizeNumberInput('12a-3.4'), '1234');
  assert.equal(sanitizeNumberInput(' 20 '), '20');
});

test('column width updates and full reset have explicit state transitions', () => {
  const populated = {
    ...createInitialState(metadata),
    status: 'ready',
    majors: [{ 专业名称: '软件工程' }],
    columnWidths: { majorName: 180 }
  };
  const resized = reduceExplorerState(populated, { type: 'SET_COLUMN_WIDTH', key: 'majorName', width: 220 }, metadata);
  assert.equal(resized.columnWidths.majorName, 220);
  const cleared = reduceExplorerState(resized, { type: 'CLEAR_ALL' }, metadata);
  assert.equal(cleared.status, 'ready');
  assert.deepEqual(cleared.majors, []);
  assert.deepEqual(cleared.filters, { schoolType: '全部', povertyStatus: '全部', subject: '全部', schoolCount: '' });
});
