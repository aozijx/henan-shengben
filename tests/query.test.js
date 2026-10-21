import test from 'node:test';
import assert from 'node:assert/strict';
import { findMappingMatches } from '../js/query.js';

test('searches only the mapping supplied for the selected year', () => {
  const mapping2026 = [{ 专科专业: '软件技术', 可报本科专业: [{ 专业名称: '旧专业' }] }];
  const mapping2027 = [{ 专科专业: '软件技术', 可报本科专业: [{ 专业名称: '新专业' }] }];

  assert.equal(findMappingMatches(mapping2026, '软件')[0].可报本科专业[0].专业名称, '旧专业');
  assert.equal(findMappingMatches(mapping2027, '软件')[0].可报本科专业[0].专业名称, '新专业');
});
