import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, reduceExplorerState, sanitizeScoreInput } from '../js/explorer.js';

const metadata = {
  defaultYear: 2026,
  defaultSort: { key: 'originalOrder', direction: 'original' }
};

test('creates a loading state from metadata defaults', () => {
  const state = createInitialState(metadata);
  assert.equal(state.status, 'loading');
  assert.equal(state.year, 2026);
  assert.deepEqual(state.sort, metadata.defaultSort);
  assert.deepEqual(state.filters, { schoolType: '全部', povertyStatus: '全部', minScore: '', maxScore: '' });
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
    filters: { schoolType: '民办', povertyStatus: '是', minScore: '100', maxScore: '200' },
    sort: { key: 'score', direction: 'desc' },
    page: 3
  };
  const reset = reduceExplorerState(changed, { type: 'RESET_FILTERS' }, metadata);
  assert.equal(reset.year, 2025);
  assert.equal(reset.specName, '商务英语');
  assert.equal(reset.majors.length, 1);
  assert.deepEqual(reset.filters, { schoolType: '全部', povertyStatus: '全部', minScore: '', maxScore: '' });
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

test('search result replacement resets the page and clears stale validation', () => {
  const state = { ...createInitialState(metadata), page: 3, validationError: '旧错误' };
  const next = reduceExplorerState(state, {
    type: 'SET_SEARCH_RESULT', majors: [{ 专业名称: '软件工程' }], specName: '软件技术'
  }, metadata);
  assert.equal(next.specName, '软件技术');
  assert.equal(next.page, 1);
  assert.equal(next.validationError, '');
});

test('score input sanitizer blocks letters, punctuation and negative signs', () => {
  assert.equal(sanitizeScoreInput('12a-3.4'), '1234');
  assert.equal(sanitizeScoreInput(' 200 '), '200');
});
