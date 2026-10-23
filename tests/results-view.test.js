import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResultWorkspaceHtml, buildExpandedYearHtml, buildYearDialogHtml } from '../js/results-view.js';
import { buildSchoolDetailHtml, buildYearSummaryHtml } from '../js/year-stack.js';

const aggregate = {
  major: {
    majorId: '080902', majorCode: '80', majorName: '软件工程', publicCourse: '公共英语',
    professionalCourse: { code: '02', name: '高等数学' }
  },
  years: {
    2026: {
      year: 2026, score: 180,
      scoreContext: { controlCumulativeCount: 45 },
      publicSummary: { schoolCount: 1, ordinaryPlanCount: 20, povertyPlanCount: 3 },
      privateSummary: { schoolCount: 1, ordinaryPlanCount: 10, povertyPlanCount: 0 },
      schools: [{
        schoolId: '河南大学', schoolName: '河南大学', schoolType: '公办',
        ordinaryPlanCount: 20, povertyPlanCount: 3,
        planEntries: [{ phone: '0371-12345678', address: '郑州市', tuition: 4400 }]
      }],
      scoreSegments: { segments: [{ score: 180, cumulativeCount: 45 }] }
    }
  }
};

test('initial aggregate summary includes courses scores ranks and split plan totals without private details', () => {
  const html = buildResultWorkspaceHtml({ aggregates: [aggregate], status: 'ready' }, {
    supportedYears: [2026], latestYear: 2026
  });

  assert.match(html, /软件工程/);
  assert.match(html, /专业代码[^<]*80/);
  assert.match(html, /公共英语/);
  assert.match(html, /高等数学/);
  assert.match(html, /省控线[^<]*180/);
  assert.match(html, /参考位次[^<]*45/);
  assert.match(html, /公办[^<]*1 所[^<]*普通 20 人[^<]*专项 3 人/);
  assert.match(html, /民办[^<]*1 所[^<]*普通 10 人/);
  assert.doesNotMatch(html, /0371-12345678|郑州市|完整分数段/);
});

test('expanded year content creates school contact details and the complete score segment table lazily', () => {
  const html = buildExpandedYearHtml(aggregate, 2026);
  assert.match(html, /0371-12345678/);
  assert.match(html, /郑州市/);
  assert.match(html, /完整分数段/);
  assert.match(html, /180/);
  assert.match(html, /45/);
});

test('year and school renderers preserve ordinary and poverty semantics', () => {
  assert.match(buildYearSummaryHtml(aggregate.years[2026]), /公办 1 所 · 普通 20 人 · 专项 3 人/);
  const schoolHtml = buildSchoolDetailHtml(aggregate.years[2026].schools[0]);
  assert.match(schoolHtml, /学费/);
  assert.match(schoolHtml, /4400/);
});

test('workspace distinguishes empty query filtered empty unpublished year and load failure', () => {
  const metadata = { supportedYears: [2026], latestYear: 2026 };
  assert.match(buildResultWorkspaceHtml({ aggregates: [], status: 'idle' }, metadata), /输入专科专业/);
  assert.match(buildResultWorkspaceHtml({ aggregates: [], status: 'ready', hasQuery: true }, metadata), /筛选条件下没有/);
  assert.match(buildResultWorkspaceHtml({ aggregates: [], status: 'unpublished' }, metadata), /尚未发布/);
  assert.match(buildResultWorkspaceHtml({ aggregates: [], status: 'error', error: '计划加载失败' }, metadata), /计划加载失败/);
});

test('cards render only selected years and keep lazy detail content out of the initial DOM', () => {
  const threeYearAggregate = {
    ...aggregate,
    years: {
      2024: { ...aggregate.years[2026], year: 2024, score: 160 },
      2025: { ...aggregate.years[2026], year: 2025, score: 170 },
      2026: aggregate.years[2026]
    }
  };
  const html = buildResultWorkspaceHtml({
    aggregates: [threeYearAggregate], status: 'ready', hasQuery: true,
    selectedYears: [2024, 2026], resultLayout: 'cards'
  }, { supportedYears: [2024, 2025, 2026] });
  assert.match(html, /2024 年/);
  assert.match(html, /2026 年/);
  assert.doesNotMatch(html, /<h4>2025 年<\/h4>|0371-12345678|完整分数段/);
});

test('table layout renders one major row from the same selected-year aggregate', () => {
  const html = buildResultWorkspaceHtml({
    aggregates: [aggregate], status: 'ready', hasQuery: true,
    selectedYears: [2026], resultLayout: 'table'
  }, { supportedYears: [2026] });
  assert.match(html, /class="aggregate-table-wrap"/);
  assert.match(html, /软件工程/);
  assert.match(html, /180/);
  assert.match(html, /1\/1/);
  assert.doesNotMatch(html, /0371-12345678|完整分数段/);
});

test('year dialog exposes metadata years and all required actions', () => {
  const html = buildYearDialogHtml({ supportedYears: [2024, 2025, 2026] }, [2024, 2026]);
  assert.match(html, /年份范围/);
  assert.match(html, /2024 年/);
  assert.match(html, /2025 年/);
  assert.match(html, /全选|仅最新年份/);
  assert.match(html, /取消|应用/);
});
