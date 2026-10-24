# UI 与手机适配改版实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以黑、白、蓝为基底，辅以少量清晰强调色，重整河南专升本查询工具的展示层级并适配手机。

**Architecture:** 保持原生 HTML/CSS/ES Modules 与现有数据流水线。调整六个分区样式表和年份筛选按钮的展示文案：先统一主题与基础形状，再把查询视图排成桌面工作台/手机单列，最后调整分析和说明视图；专业比较、年度汇总、院校明细仍复用当前渲染逻辑。

**Tech Stack:** 原生 HTML、CSS、CSS Grid、CSS custom properties、原生 ES Modules；不增加运行时依赖。

**Spec:** `docs/superpowers/specs/2026-10-24-ui-mobile-refresh-design.md`

## Global Constraints

- 不改查询语义、筛选默认值、年份选择、排序、聚合、预览、导出、统计口径或数据来源。
- 不删减现有字段、操作、分析图表或数据说明。
- 不引入前端框架、组件库或新的运行时依赖。
- 深色主题使用页面 `#0f1317`、卡片和表格 `#171d24`，边线使用低亮度灰白以降低反差；蓝色及其他强调色控制在文字、图表线条和小面积交互状态。
- 超椭圆仅渐进增强；`border-radius` 必须独立提供完整兼容外观。MDN 当前将 `corner-shape` / `superellipse()` 标为 Limited availability，故不得依赖它们布局或表达状态：[corner-shape](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/corner-shape)、[superellipse()](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/superellipse)。
- 全局页面导航保持普通文档流；仅结果表与导出预览表头在各自的滚动容器内冻结。

## Files and Responsibilities

- `css/base.css`: 浅色/深色主题色、边界、表面、阴影、圆角、焦点与基础排版 token。
- `css/layout.css`: 页面宽度、masthead、数据规模卡片、页签、视图间距与断点。
- `css/query.css`: 搜索、桌面查询工作台网格、筛选、结果层级、年度/院校卡片和局部滚动表格。
- `css/preview.css`: 导出预览摘要、表格滚动容器和分页控件。
- `css/stats.css`: 分析卡片、计划摘要、图表和分析列表控件。
- `css/about.css`: 数据说明段落与免责声明卡片。
- 不改 `index.html`、查询行为或 metadata。`js/explorer.js` 仅去掉年份字段标题已表达的重复按钮前缀；其余改动限于 CSS 和文档。

## Review Focus

- 360–390 px 宽度时，页面本身不产生横向溢出；宽表格只在自身容器内滚动。
- 桌面查询工作台中筛选区不挤压结果区；手机上筛选区完整显示在结果前。
- 卡片/表格结果切换和展开详情后，现有数据层级与操作仍可读可用。
- 浅色、深色和跟随系统下，文字、边界、焦点环及语义标记仍有足够区分度。
- `corner-shape` 不支持时由普通圆角完整回退；导航不吸顶，表格表头仍只在指定容器内吸顶。

## Implementation Tasks

### Task 1: Establish the shared visual system

**Files:**
- Modify: `css/base.css`
- Modify: `css/layout.css`

**Interfaces:**
- Produces: shared CSS variables for muted light/dark surfaces, text, borders, semantic accents, shadows, radii and spacing. Existing CSS consumers continue using token names where semantics still match.

- [x] **Step 1: Tune theme tokens**

  Use the approved page `#0f1317` and card/table `#171d24` dark surfaces, with muted gray-white borders. Use blue for primary actions, links and selected states, with small teal, amber, violet and rust accents for metrics, charts and semantic labels. Keep accent fills localized.

- [x] **Step 2: Add progressive superellipse styling**

  Define conventional `border-radius` first for shared cards and controls. Add a narrowly scoped `@supports (corner-shape: superellipse(1.2))` enhancement for those surfaces; do not use it on clipping or sizing logic.

- [x] **Step 3: Rework the shared page shell and hierarchy**

  Update `.page`, `.masthead`, `h1`, `.lede`, `.stats`, `.tabs`, `.tab`, `.view`, and `.footer` for consistent spacing and typography. Make `.tabs` non-sticky while preserving keyboard-visible focus.

- [x] **Step 4: Review light and dark shared surfaces**

  Inspect header, metric cards, tabs, buttons and focus states in both themes. Adjust tokens in `base.css` if any text or border loses distinction.

### Task 2: Reorganize the query workspace and mobile results

**Files:**
- Modify: `css/query.css`
- Modify: `css/preview.css`
- Modify: `js/explorer.js` (display label only)

**Interfaces:**
- Consumes: existing `#view-query` children, generated `.filter-panel`, `.result`, `.preview-section`, `.export-actions`, `.aggregate-card`, `.aggregate-table-wrap` and `.year-selection-dialog`.
- Produces: desktop two-column filter/result workspace and a single-column mobile order with filter controls before results; preview/export remain after the result.

- [x] **Step 1: Set the desktop workspace grid**

  Replace the vertical flex ordering on `#view-query.is-active` with a CSS grid. Keep search, hint and status full width; place `.filter-panel` in a stable narrow column and `.result` in a flexible content column; keep preview and export after the results across the available width.

- [x] **Step 2: Apply the mobile single-column layout**

  At the mobile breakpoint, switch the query grid to one column, maintain search → hint/status → filters → result → preview → export order, and prevent grid children from forcing page-level overflow with `min-width: 0` and local scroll wrappers.

- [x] **Step 3: Refine result hierarchy and controls**

  Restyle result toolbar, empty state, aggregate cards, year summaries, school detail cards, filter groups and year dialog using shared tokens. Preserve semantic distinction and the professional → yearly → school detail reading order.

- [x] **Step 4: Tune preview table and touch controls**

  Adjust preview summary, table density, pagination and action controls for narrow screens. Keep horizontal scrolling scoped to `.preview-scroll` and keep its header sticky only inside that container.

- [x] **Step 5: Review the query view at desktop and phone widths**

  Inspect a desktop width and 390 px / 360 px widths in light and dark themes, with both result layouts and an expanded detail. Confirm no page-level horizontal scrolling and usable control targets.

### Task 3: Adapt analytics and explanatory content

**Files:**
- Modify: `css/stats.css`
- Modify: `css/about.css`

**Interfaces:**
- Consumes: current analytics and explanation markup; no JavaScript interface changes.
- Produces: consistent panels and readable single-column layouts on narrow viewports.

- [x] **Step 1: Refine analytics cards and summary grid**

  Apply shared surfaces to chart cards and plan summaries. Preserve compact multi-column summaries where they fit, then collapse to a readable phone grid; ensure chart containers shrink to their available width.

- [x] **Step 2: Adapt analytics controls and tables**

  Let major search, curve selection and action controls wrap without clipping. Keep analytics table overflow local to its wrapper and maintain readable cell spacing.

- [x] **Step 3: Refine data explanation cards**

  Tune card spacing, headings, list indentation and warning treatment for narrow screens while preserving the full text and link wrapping.

- [x] **Step 4: Review all three views at desktop and phone widths**

  Inspect query, analytics and about views at desktop and 390 px / 360 px widths under light and dark themes. Confirm no page-level horizontal overflow, visible focus, legible charts and intact local table scrolling.

## Scope Review

- All approved visual goals map to Tasks 1–3.
- All query behaviors remain in existing HTML/JavaScript and are explicitly preserved.
- The year filter button omits its redundant “年份：” prefix because its field label already says “年份”; the accessible name still announces the year selection.
- Automated test files or test commands are not added to this plan; review is visual and limited to the requested responsive presentation.
- The only CSS layout reorganization is the query view's desktop grid and mobile single-column presentation.
