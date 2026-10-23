import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMajorRows } from '../js/major-match.js';

test('matches vocational suffix and does not merge ambiguous shared codes', () => {
  const rows = [
    { code: '51', name: '计算机科学与技术', count: 2070 },
    { code: '51', name: '计算机应用工程', count: 150 }
  ];
  const select = (name) => selectMajorRows(rows, '51', name, row => row.code, row => row.name);
  assert.deepEqual(select('计算机应用工程（本科层次职业教育专业）').map(row => row.count), [150]);
  assert.deepEqual(select('不存在的专业'), []);
});

test('allows code fallback only for a single plan name', () => {
  const rows = [{ code: '80', name: '软件工程', count: 20 }];
  assert.deepEqual(selectMajorRows(rows, '80', '旧版软件专业', row => row.code, row => row.name), rows);
});
