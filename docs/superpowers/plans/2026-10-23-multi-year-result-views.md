# 多年份聚合结果视图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户用 metadata 驱动的弹窗勾选任意年份，并在聚合卡片与表格间切换，同时保证筛选、预览和 CSV 严格消费同一份多年份结果。

**Architecture:** 将年份选择与布局作为受限 UI 状态，`focusYear` 始终从已勾选年份导出并驱动专业对照索引。新增纯结果模型把聚合、筛选、排序和字段投影集中到一条路径；卡片、表格、分页预览和 CSV 只渲染或序列化它的派生数据，不再各自重算业务规则。

**Tech Stack:** 原生 HTML `<dialog>`、CSS、ES Modules、Node.js `node:test`、Ajv JSON Schema

**Spec:** `docs/superpowers/specs/2026-10-22-aggregated-query-redesign-design.md`

**Related plan:** 增补并完成 `docs/superpowers/plans/2026-10-22-aggregated-query-redesign.md` 的 Task 6–9；已完成的数据采集、metadata v2、聚合卡片基础实现不重做。

**实施状态（2026-10-23）：** 已完成。Task 1–3 分别落在 `fe30d6d`、`c15049f`、`8b5a12d`；Task 4 的 2027 metadata-only 演练、维护文档和全量验收随本文档更新提交。未纳入提交的 `.superpowers/` 仅为本地执行账本。

## Global Constraints

- 数据流水线固定为“原始数据 → 归一化 → 聚合 → 筛选 → 排序 → 预览表格 → 导出”。
- `supportedYears` 是唯一可选年份来源；新增年份不得在业务 JavaScript 中增加年份分支。
- `focusYear` 为勾选集合中最新年份，切换它必须调用 `setQueryYear`，不能继续使用 `defaultYear` 的映射。
- 选中年份、布局、筛选、排序、分页和列宽可作为 UI 偏好持久化；原始数据、索引、聚合结果和筛选结果不得写入 localStorage。
- 至少保留一个已选年份；清除本地存储恢复 metadata 默认值并保留内存 repository 缓存。
- 聚合卡片、表格、预览和 CSV 必须共享同一排序后的完整结果；分页和布局不得影响 CSV。
- 只暂存任务列出的精确路径；绝不暂存 `convert/issue_reports.py` 或其他无关工作区变更。

## Review Focus

- 用户取消所有年份后点击应用：维持上次有效选择并显示就地提示；Task 1 的 reducer/DOM 测试覆盖。
- 用户只选 2024 再搜索：使用 2024 对照而非 `defaultYear`；Task 1 的 query 年份切换测试覆盖。
- 年份筛选后某专业只在一个年份命中：保留该专业，但卡片、表格与 CSV 只显示所选年份；Task 2 的结果模型测试覆盖。
- 用户翻到预览第二页或切换布局后导出：CSV 仍导出完整同序行集；Task 2 的 preview/export 测试覆盖。
- metadata 未来加入 2027：弹窗、列与表格自动出现 2027，不出现硬编码年份；Task 4 的 metadata-only fixture 测试覆盖。

---

### Task 1: metadata 驱动的年份/布局状态与查询索引切换

**Files:**
- Modify: `metadata/school-data.json`
- Modify: `metadata/school-data.schema.json`
- Modify: `js/metadata.js`
- Modify: `js/explorer-state.js`
- Modify: `js/preferences.js`
- Modify: `js/query.js`
- Modify: `tests/metadata.test.js`
- Modify: `tests/explorer-state.test.js`
- Modify: `tests/preferences.test.js`
- Modify: `tests/query.test.js`

**Interfaces:**
- Consumes: metadata 的 `supportedYears`、`defaultYear` 和新增 `uiDefaults`。
- Produces: `normalizeSelectedYears(years, metadata) -> number[]`、`getFocusYear(selectedYears, metadata) -> number`；state 的 `selectedYears/focusYear/resultLayout`；`setQueryYear(year) -> void`。

- [ ] **Step 1: 写年份和布局状态的失败测试**

在 `tests/explorer-state.test.js` 断言默认策略选择全部支持年份、`SET_SELECTED_YEARS` 去重排序并拒绝空集合、更新 `focusYear` 与页码；`SET_RESULT_LAYOUT` 只接受 `cards`/`table`。在 `tests/query.test.js` 为 2024/2026 不同映射断言 `setQueryYear(2024)` 后回车补全和提示均来自 2024。

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/explorer-state.test.js tests/query.test.js`

Expected: FAIL，缺少年份选择状态或 `setQueryYear`。

- [ ] **Step 3: 扩展 metadata、state、偏好与 query 接口**

为 schema 与生产 metadata 增加 `uiDefaults: { selectedYears: "allSupportedYears", resultLayout: "cards" }`。在 `js/metadata.js` 实现年份规范化和 `focusYear` 派生；reducer 只接受 metadata 支持的年份，偏好读写仅保存合法 `selectedYears/resultLayout`。`js/query.js` 以内部 active query year 查询 `getMappingByYear`，并在切换后使提示年份一致。

- [ ] **Step 4: 运行状态与偏好测试**

Run: `node --test tests/metadata.test.js tests/explorer-state.test.js tests/preferences.test.js tests/query.test.js`

Expected: PASS。

- [ ] **Step 5: 提交独立状态改动**

```bash
git add metadata/school-data.json metadata/school-data.schema.json js/metadata.js js/explorer-state.js js/preferences.js js/query.js tests/metadata.test.js tests/explorer-state.test.js tests/preferences.test.js tests/query.test.js
git commit -m "feat: add metadata driven year selection state"
```

### Task 2: 统一多年份结果模型、预览与 CSV

**Files:**
- Create: `js/result-model.js`
- Modify: `js/pipeline.js`
- Modify: `js/explorer.js`
- Modify: `js/preview.js`
- Modify: `js/export.js`
- Modify: `js/app.js`
- Modify: `tests/pipeline.test.js`
- Modify: `tests/preview.test.js`
- Modify: `tests/export.test.js`
- Modify: `tests/integration.test.js`

**Interfaces:**
- Consumes: 规范 `MajorAggregate[]`、`selectedYears`、筛选和排序状态、metadata 字段定义。
- Produces: `buildResultModel(input) -> { aggregates, allRows, effectiveSchoolCount, effectiveSchoolYear }`；`createPreviewModel(aggregates, metadata, state)`；`prepareExport(previewModel, metadata, focusYear)`。

- [ ] **Step 1: 写结果模型与导出一致性的失败测试**

在 `tests/pipeline.test.js` 覆盖多选年份中“任一年满足全部年份筛选即保留”的语义，断言未选年份不生成行字段。保留并完善工作区已有的 `createPreviewModel` 和 `prepareExport` 红灯测试：`allRows` 是完整排序集、`pageRows` 只是分页切片、`prepareExport` 拒绝 error/空模型并使用 `allRows`。

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/pipeline.test.js tests/preview.test.js tests/export.test.js`

Expected: FAIL，缺少共享结果模型、`createPreviewModel` 与 `prepareExport`。

- [ ] **Step 3: 实现唯一的聚合筛选排序投影路径**

新增 `js/result-model.js`：先按 `selectedYears` 构建/裁剪 `MajorAggregate`，再执行专业属性与逐年计划/分数筛选、稳定排序，最后投影 metadata 展开的预览行。`js/explorer.js` 和 `js/app.js` 只传递该结果模型；`js/preview.js` 从 `allRows` 生成分页 HTML；`js/export.js` 只接受 ready 且非空的 preview model 并输出 `focusYear` 文件名。保留 `formatFieldValue` 作为预览和 CSV 的共同格式化器。

- [ ] **Step 4: 运行结果路径测试**

Run: `node --test tests/pipeline.test.js tests/preview.test.js tests/export.test.js tests/integration.test.js`

Expected: PASS，且 CSV 的字段、值、顺序和年份集合与预览完整行集相同。

- [ ] **Step 5: 提交共享结果路径**

```bash
git add js/result-model.js js/pipeline.js js/explorer.js js/preview.js js/export.js js/app.js tests/pipeline.test.js tests/preview.test.js tests/export.test.js tests/integration.test.js
git commit -m "refactor: share selected-year result model"
```

### Task 3: 年份弹窗和卡片/表格双布局

**Files:**
- Modify: `index.html`
- Modify: `js/explorer.js`
- Modify: `js/results-view.js`
- Modify: `js/year-stack.js`
- Modify: `css/query.css`
- Modify: `css/preview.css`
- Modify: `tests/results-view.test.js`
- Modify: `tests/render.test.js`

**Interfaces:**
- Consumes: Task 1 的 `selectedYears/focusYear/resultLayout` 和 Task 2 的 `buildResultModel` 输出。
- Produces: `renderResultWorkspace(root, model, metadata, dispatch)` 同时渲染 cards/table；可访问的年份 `<dialog>` 与布局切换控件。

- [ ] **Step 1: 写弹窗与双布局失败测试**

在 `tests/results-view.test.js` 断言 2024/2026 的 `selectedYears` 只渲染这两年，`resultLayout: 'table'` 生成每专业一行且列与卡片摘要来自同一 aggregate；未勾选年份、电话地址和完整分数段都不进入初始 DOM。`tests/render.test.js` 覆盖弹窗操作文案及 table 布局的小屏横向容器。

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/results-view.test.js tests/render.test.js`

Expected: FAIL，当前只渲染全部年份卡片且没有年份弹窗/表格布局。

- [ ] **Step 3: 实现 dialog、布局控件和懒详情**

在结果区右上角提供“年份”“布局”按钮；`<dialog>` 使用复选框和“全选/仅最新年份/取消/应用”，应用事件发出 `SET_SELECTED_YEARS`。卡片和表格使用相同 `model.aggregates` 与 `selectedYears`；表格沿用横向滚动并提供进入同一展开详情的入口。所有按钮有可读标签、焦点顺序和 loading/empty/disabled 状态。

- [ ] **Step 4: 运行视图测试及浏览器冒烟检查**

Run: `node --test tests/results-view.test.js tests/render.test.js`

Expected: PASS。

Manual: 选择一个旧年份、多个年份和“仅最新年份”，确认回车搜索的对照提示、卡片、表格、预览和导出文件名均使用同一 `focusYear`/年份集合；在 390px 宽度确认表格横向滚动。

- [ ] **Step 5: 提交交互与布局**

```bash
git add index.html js/explorer.js js/results-view.js js/year-stack.js css/query.css css/preview.css tests/results-view.test.js tests/render.test.js
git commit -m "feat: switch multi-year aggregate result layouts"
```

### Task 4: 年度演练、文档与全量验收

**Files:**
- Modify: `README.md`
- Modify: `data/README.md`
- Modify: `docs/superpowers/specs/2026-10-22-aggregated-query-redesign-design.md`
- Modify: `tests/fixtures/metadata-2027.json`
- Modify: `tests/integration.test.js`

**Interfaces:**
- Consumes: Task 1–3 的元数据、结果模型与视图接口。
- Produces: 2027 metadata-only 年度演练和维护说明。

- [ ] **Step 1: 写 2027 metadata-only 演练测试**

只向 fixture 新增 2027 的 source/fields，断言年份弹窗、默认全选、`focusYear`、表格列、预览行和 CSV 都包含 2027，且测试源码不依赖生产代码中的 `2027` 分支。

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/integration.test.js`

Expected: FAIL，直到 Task 1–3 接口完整接通。

- [ ] **Step 3: 更新维护文档并完成验收**

记录新增年份只需更新 `yearSources/supportedYears/uiDefaults` 与数据文件，说明年份弹窗、`focusYear`、布局偏好、清除存储以及 CSV 与预览的单一结果来源。

- [ ] **Step 4: 运行全量验证**

Run: `npm test`

Run: `node --check js/result-model.js`

Run: `git diff --check`

Expected: 全部 PASS；除本任务文件外不出现暂存变更。

- [ ] **Step 5: 提交文档与演练**

```bash
git add README.md data/README.md docs/superpowers/specs/2026-10-22-aggregated-query-redesign-design.md tests/fixtures/metadata-2027.json tests/integration.test.js
git commit -m "docs: document multi-year result maintenance"
```
