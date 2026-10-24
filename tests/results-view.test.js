import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResultWorkspaceHtml, buildExpandedMajorHtml, buildYearDialogHtml, buildResultViewModel, resultMessage } from '../js/results-view.js';
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

test('initial aggregate summary includes courses, scores and split plan totals without unavailable ranks or private details', () => {
  const html = buildResultWorkspaceHtml({ aggregates: [aggregate], status: 'ready' }, {
    supportedYears: [2026], latestYear: 2026
  });

  assert.match(html, /软件工程/);
  assert.match(html, /专业代码[^<]*80/);
  assert.match(html, /公共英语/);
  assert.match(html, /高等数学/);
  assert.match(html, /省控线[^<]*180/);
  assert.doesNotMatch(html, /参考位次/);
  assert.match(html, /公办[^<]*1 所[^<]*普通 20 人[^<]*专项 3 人/);
  assert.match(html, /民办[^<]*1 所[^<]*普通 10 人/);
  assert.doesNotMatch(html, /0371-12345678|郑州市|完整分数段/);
});

test('card places its detail action beside the major title before yearly summaries', () => {
  const html = buildResultWorkspaceHtml({ aggregates: [aggregate], status: 'ready', hasQuery: true }, {
    supportedYears: [2026], latestYear: 2026
  });

  assert.match(html, /<header><div class="aggregate-card-heading"><div><h3>软件工程/);
  assert.match(html, /data-expand-major="0"[^>]*>查看院校详情/);
  assert.ok(html.indexOf('data-expand-major="0"') < html.indexOf('class="year-overview"'));
});

test('result workspace contains only result content and leaves layout controls to its static shell', () => {
  const html = buildResultWorkspaceHtml({ aggregates: [aggregate], status: 'ready', hasQuery: true }, {
    supportedYears: [2026], latestYear: 2026
  });

  assert.match(html, /class="aggregate-list"/);
  assert.doesNotMatch(html, /data-result-layout|result-toolbar|layout-icon/);
});

test('expanded major content creates school comparison and score segment tables lazily', () => {
  const html = buildExpandedMajorHtml(aggregate, [2026]);
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

test('metadata visibility rule hides poverty labels after selecting ordinary plans only', () => {
  const metadata = {
    supportedYears: [2026],
    resultVisibilityRules: [{
      when: { filterKey: 'povertyStatus', equals: '否' },
      hide: ['povertyPlan']
    }]
  };
  const html = buildResultWorkspaceHtml({
    aggregates: [aggregate], status: 'ready', hasQuery: true, selectedYears: [2026],
    filters: { povertyStatus: '否' }
  }, metadata);

  assert.match(html, /普通 20 人/);
  assert.doesNotMatch(html, /专项 3 人|建档立卡专项/);
});

test('school details expose the complete plan record instead of only contact fields', () => {
  const school = {
    ...aggregate.years[2026].schools[0],
    planEntries: [{
      schoolCode: '6001', majorCode: '80', majorName: '软件工程', admissionCategory: '普通专升本',
      duration: 2, tuition: 4400, accommodation: 800, address: '郑州市', phone: '0371-12345678',
      notes: '办学地点：主校区', charterUrl: 'https://example.edu/charter'
    }]
  };
  const html = buildSchoolDetailHtml(school);

  assert.match(html, /6001/);
  assert.match(html, /普通专升本/);
  assert.match(html, /住宿费/);
  assert.match(html, /800/);
  assert.match(html, /招生章程/);
  assert.match(html, /https:\/\/example.edu\/charter/);
});

test('result status helper distinguishes empty query filtered empty unpublished year and load failure', () => {
  const metadata = { supportedYears: [2026], latestYear: 2026 };
  assert.match(resultMessage({ status: 'idle' }, metadata), /输入专科专业/);
  assert.match(resultMessage({ status: 'ready', hasQuery: true }, metadata), /筛选条件下没有/);
  assert.match(resultMessage({ status: 'unpublished' }, metadata), /尚未发布/);
  assert.match(resultMessage({ status: 'error', error: '计划加载失败' }, metadata), /计划加载失败/);
  assert.equal(buildResultWorkspaceHtml({ aggregates: [], status: 'ready', hasQuery: true }, metadata), '');
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
  assert.match(html, /公办 1 所/);
  assert.match(html, /历年概览/);
  assert.doesNotMatch(html, /2026 省控线|2026 院校\(公\/民\)/);
  assert.match(html, /class="aggregate-table-detail" hidden/);
  assert.match(html, /查看院校详情/);
  assert.doesNotMatch(html, /0371-12345678|完整分数段/);
});

test('year controls make selected years and focus year visible', () => {
  const metadata = { supportedYears: [2024, 2025, 2026] };
  const workspace = buildResultWorkspaceHtml({
    aggregates: [aggregate], status: 'ready', hasQuery: true,
    selectedYears: [2024, 2026], resultLayout: 'cards'
  }, metadata);
  const dialog = buildYearDialogHtml(metadata, [2024, 2026]);

  assert.doesNotMatch(workspace, /data-result-action="years"|year-selection-dialog|result-toolbar/);
  assert.match(dialog, /专业摘要、院校明细和导出字段/);
  assert.match(dialog, /已选 2\/3 年/);
  assert.match(dialog, /当前基准：2026 年/);
});

test('result view model normalizes shared years and layout without mutating metadata', () => {
  const metadata = { supportedYears: [2024, 2025, 2026] };
  const model = buildResultViewModel({
    aggregates: [aggregate], selectedYears: [2026, 2024, 2026], resultLayout: 'unknown'
  }, metadata);

  assert.deepEqual(model.selectedYears, [2024, 2026]);
  assert.equal(model.resultLayout, 'cards');
  assert.equal(metadata.__selectedYears, undefined);
});

test('workspace renders expanded details from stable major identity state', () => {
  const html = buildResultWorkspaceHtml(buildResultViewModel({
    aggregates: [aggregate], selectedYears: [2026], expandedDetails: { '080902': true }
  }, { supportedYears: [2026] }), { supportedYears: [2026] });

  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /收起院校详情/);
  assert.match(html, /0371-12345678/);
});

test('year dialog exposes metadata years and all required actions', () => {
  const html = buildYearDialogHtml({ supportedYears: [2024, 2025, 2026] }, [2024, 2026]);
  assert.match(html, /显示年份/);
  assert.match(html, /2024 年/);
  assert.match(html, /2025 年/);
  assert.match(html, /全选|仅最新年份/);
  assert.match(html, /取消|应用/);
});

test('table layout keeps a closed detail subrow adjacent to its major row', () => {
  const html = buildResultWorkspaceHtml({
    aggregates: [aggregate], status: 'ready', hasQuery: true,
    selectedYears: [2026], resultLayout: 'table'
  }, { supportedYears: [2026] });
  assert.match(html, /class="aggregate-table-row"[\s\S]*class="aggregate-table-detail" hidden/);
  assert.match(html, /data-major-detail="0"/);
});
