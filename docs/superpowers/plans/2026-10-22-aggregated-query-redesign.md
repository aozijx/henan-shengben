# 河南专升本聚合查询与性能重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有河南专升本查询页重构为 metadata 驱动、渐进加载的一次搜索聚合工作区，并保证筛选、预览和导出共享同一结果模型。

**Architecture:** 在数据加载边界把中文源字段归一化为稳定领域对象，再由纯函数聚合专业、年份、学校、普通计划与建档立卡计划。页面分成搜索、筛选状态、聚合结果、年份院校明细和预览导出几个小模块；数据仓库按 source role 懒加载并以内存 Promise 缓存，年度列由 metadata 模板展开。

**Tech Stack:** 原生 HTML/CSS、ES Modules、Node.js `node:test`、Ajv JSON Schema、ECharts（仅数据分析页动态加载）

**Spec:** `docs/superpowers/specs/2026-10-22-aggregated-query-redesign-design.md`

## Global Constraints

- 保持原生 HTML/CSS/ES Modules，不引入框架或构建工具。
- 数据流水线固定为“原始数据 → 归一化 → 聚合 → 筛选 → 排序 → 预览表格 → 导出”。
- 导出必须消费完整预览结果与同一字段格式化器，不能读取当前分页 DOM。
- 业务原始数据、索引、聚合结果和筛选结果不得写入 localStorage。
- 新增年份只允许修改/新增数据文件和 metadata，不修改业务逻辑。
- 分数数据统一称为“省控线”，不得误称院校录取线。
- 缺失值不得转换为 0；fallback 院校不得生成虚构计划人数。
- 保留专业名称/代码、公共课、专业基础课、公办/民办、建档立卡、三年省控线、三年计划及院校全部现有明细。

## Review Focus

- 普通计划与建档立卡记录使用不同院校代号但学校名称相同：应合并学校、分开人数；Task 3 的聚合测试覆盖。
- 专业名称含空白、换行、全角括号或 `T/K` 后缀：匹配应沿用规范化规则且不串专业；Task 2 的归一化测试覆盖。
- 历史年份计划加载失败：当前年份结果仍可用，预览/导出明确指出缺失年份；Task 7 的错误状态测试覆盖。
- 分数最小值大于最大值、负数或字母输入：状态不进入无效管线；Task 4 的 reducer 测试覆盖。
- 用户只看预览第一页后导出：CSV 仍包含全部筛选排序行且列值一致；Task 6 的集成测试覆盖。

---

### Task 1: metadata v2 与轻量查询索引契约

**Files:**
- Modify: `metadata/school-data.json`
- Modify: `metadata/school-data.schema.json`
- Create: `metadata/query-index.schema.json`
- Create: `data/专科专业查询索引.json`
- Modify: `js/metadata.js`
- Modify: `tests/metadata.test.js`
- Modify: `tests/schema-validation.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: 现有 `supportedYears`、`yearSources` 和字段开关。
- Produces: `expandMetadata(metadata) -> { fields, filters, supportedYears, ... }`；展开后的年度字段供 Task 4、5、6 使用。

- [ ] **Step 1: 写 metadata v2 失败测试**

在 `tests/metadata.test.js` 增加 `expands yearly field templates for every supported year`、`rejects duplicate expanded field keys`、`rejects invalid filter defaults`，断言 2027 fixture 只增加年份配置即可得到 `score2027`、`schoolSplit2027`、`ordinaryPlanSplit2027`、`povertyPlanSplit2027`。

- [ ] **Step 2: 运行 metadata 测试确认失败**

Run: `node --test tests/metadata.test.js`

Expected: FAIL，提示 `expandMetadata` 未导出或 v2 字段缺失。

- [ ] **Step 3: 扩展 metadata schema 与运行时校验**

在 `js/metadata.js` 实现 `export function expandMetadata(metadata)`；校验 `queryIndexSource`、`sourceFields`、`derivedFields.publicCourse`、`yearFieldTemplates`、`filters`、`scorePresets`，再将年度模板展开成现有消费者可读的扁平字段。

- [ ] **Step 4: 生成并验证轻量查询索引**

从 mapping 的 558 个 `专科专业` 生成 `data/专科专业查询索引.json`，格式为字符串数组；在 `query-index.schema.json` 中禁止空字符串和重复项，并把 schema 加入 `tests/schema-validation.test.js`。

- [ ] **Step 5: 迁移 metadata 配置**

把逐年重复的分数、院校数和计划数字段改为年度模板；加入公共课推导规则、专业基础课枚举、分数快捷档位、院校数比较符和 UI 字段开关。

- [ ] **Step 6: 更新 metadata 文档并运行测试**

Run: `node --test tests/metadata.test.js tests/schema-validation.test.js`

Expected: PASS，真实 metadata、所有真实数据文件和 2027 fixture 均通过。

- [ ] **Step 7: 提交 metadata 契约**

```bash
git add metadata/school-data.json metadata/school-data.schema.json metadata/query-index.schema.json data/专科专业查询索引.json js/metadata.js tests/metadata.test.js tests/schema-validation.test.js README.md
git commit -m "refactor: define aggregated query metadata contract"
```

### Task 2: 渐进式数据仓库与源数据归一化

**Files:**
- Create: `js/data-source.js`
- Create: `js/model.js`
- Modify: `js/data.js`
- Modify: `js/bootstrap.js`
- Modify: `tests/data.test.js`
- Create: `tests/model.test.js`

**Interfaces:**
- Consumes: Task 1 的展开 metadata 与 source field mappings。
- Produces: `createDataRepository(metadata, fetchImpl)`；`repository.loadQueryIndex()`；`repository.ensureMapping(year)`；`repository.ensureScores(year)`；`repository.ensurePlans(year)`；`normalizeMajorOption(raw, metadata)`；`normalizePlanEntry(raw, metadata)`。

- [ ] **Step 1: 写请求阶段与缓存失败测试**

在 `tests/data.test.js` 断言启动只请求 metadata/query index；同一 source URL 的并发请求共享 Promise；`ensurePlans(2025)` 未调用前不请求 `招生计划2025.json`；失败 Promise 可通过显式 `retry` 重新请求。

- [ ] **Step 2: 写归一化失败测试**

在 `tests/model.test.js` 断言中文源字段生成规范 `MajorOption`/`PlanEntry`，公共英语/专业英语由 metadata 规则产生，空白换行被规范化，六位代码忽略 `T/K` 后缀但原值保留。

- [ ] **Step 3: 运行数据与模型测试确认失败**

Run: `node --test tests/data.test.js tests/model.test.js`

Expected: FAIL，提示 repository 和 normalize 接口不存在。

- [ ] **Step 4: 实现按 source role 缓存的数据仓库**

在 `js/data-source.js` 实现 `createDataRepository(metadata, fetchImpl)`，内部使用 `Map<string, Promise<unknown>>`；每个 ensure 方法返回带年份和加载状态的结果，不写 localStorage。

- [ ] **Step 5: 实现源数据归一化**

在 `js/model.js` 实现 `normalizeMajorOption(raw, metadata)`、`normalizeScoreEntry(raw, metadata)`、`normalizePlanEntry(raw, metadata)` 和轻量结构错误，错误信息包含 source role、年份、行号和字段。

- [ ] **Step 6: 把 `js/data.js` 改为兼容 facade**

让现有查询调用逐步转发到 repository/index API，暂时保留公开 getters，避免 Task 2 同时改写所有 UI。

- [ ] **Step 7: 运行测试并提交**

Run: `node --test tests/data.test.js tests/model.test.js tests/schema-validation.test.js`

Expected: PASS。

```bash
git add js/data-source.js js/model.js js/data.js js/bootstrap.js tests/data.test.js tests/model.test.js
git commit -m "perf: add lazy data repository and normalization"
```

### Task 3: 专业—年份—院校聚合领域模型

**Files:**
- Create: `js/aggregate.js`
- Modify: `js/pipeline.js`
- Create: `tests/aggregate.test.js`
- Modify: `tests/pipeline.test.js`

**Interfaces:**
- Consumes: Task 2 的规范 `MajorOption`、`PlanEntry` 与年度 score indexes。
- Produces: `buildMajorAggregates({ majors, years, scoresByYear, plansByYear, fallbackByYear }) -> MajorAggregate[]`；`projectPreviewRows(aggregates, metadata) -> object[]`。

- [ ] **Step 1: 写学校合并与分组失败测试**

在 `tests/aggregate.test.js` 构造同校普通代码 `6001`、专项代码 `6401`，断言聚合后只有一个学校，保留两个原始代码，并分别得到 `ordinaryPlanCount` 和 `povertyPlanCount`。

- [ ] **Step 2: 写公办民办年度汇总失败测试**

断言每年同时生成 public/private 的去重学校数、普通计划数、建档立卡计划数；fallback 行只增加学校明细，不增加任何计划人数。

- [ ] **Step 3: 写缺失年份和专业别名失败测试**

断言无省控线为 `null`、无计划为 `availability: 'unlisted'`，财务管理 `99/A1` 别名继续命中且不会匹配其他专业。

- [ ] **Step 4: 运行聚合测试确认失败**

Run: `node --test tests/aggregate.test.js tests/pipeline.test.js`

Expected: FAIL，提示 `buildMajorAggregates` 未定义。

- [ ] **Step 5: 实现纯聚合函数**

在 `js/aggregate.js` 实现 `buildMajorAggregates(input)`，以规范学校名作为聚合键，以 metadata 支持年份为循环来源；不得引用 DOM、localStorage 或全局活动年份。

- [ ] **Step 6: 让 pipeline 消费聚合模型**

把 `js/pipeline.js` 的源行读取改为 `filterAggregates(aggregates, filters, metadata)`、`sortAggregates(rows, sort, metadata)`、`projectPreviewRows(rows, metadata)`，保持纯函数。

- [ ] **Step 7: 运行测试并提交**

Run: `node --test tests/aggregate.test.js tests/pipeline.test.js`

Expected: PASS。

```bash
git add js/aggregate.js js/pipeline.js tests/aggregate.test.js tests/pipeline.test.js
git commit -m "refactor: aggregate majors years schools and plans"
```

### Task 4: metadata 驱动的查询、筛选与排序状态

**Files:**
- Create: `js/explorer-state.js`
- Modify: `js/explorer.js`
- Modify: `js/query.js`
- Modify: `js/preferences.js`
- Modify: `tests/explorer-state.test.js`
- Modify: `tests/query.test.js`
- Modify: `tests/preferences.test.js`

**Interfaces:**
- Consumes: Task 1 展开后的 filters/sort fields；Task 3 的聚合结果。
- Produces: `createExplorerState(metadata)`；`reduceExplorerState(state, event, metadata)`；`resolveQuery(index, input, selectedName)`。

- [ ] **Step 1: 写回车补全失败测试**

在 `tests/query.test.js` 断言精确输入直接采用；模糊输入采用当前候选或首个候选并返回完整专业名；无候选返回 `not-found`，不猜测。

- [ ] **Step 2: 写全部筛选维度失败测试**

在 `tests/explorer-state.test.js` 覆盖办学性质、招生类别、公共课、专业基础课、分数年份/上下限/快捷档位、院校数年份/下限和 metadata 排序。

- [ ] **Step 3: 写非法分数状态失败测试**

断言负数、字母、超 metadata 最大值、最小值大于最大值不会更新为有效筛选，并返回可渲染的字段错误。

- [ ] **Step 4: 运行状态测试确认失败**

Run: `node --test tests/query.test.js tests/explorer-state.test.js tests/preferences.test.js`

Expected: FAIL，提示新状态字段或 `resolveQuery` 不存在。

- [ ] **Step 5: 抽离 reducer 并动态生成控件状态**

在 `js/explorer-state.js` 实现纯 reducer；`js/explorer.js` 只负责把 metadata 控件描述映射为 DOM 事件，不再显式引用 `schoolType`、`povertyStatus`、`subject`、`schoolCount`。

- [ ] **Step 6: 调整查询确认与 UI 偏好持久化**

`js/query.js` 回填完整专业名并输出查询上下文；`js/preferences.js` 只持久化 metadata 允许的 UI filter/sort/pageSize/columnWidth，不写结果数据。

- [ ] **Step 7: 运行测试并提交**

Run: `node --test tests/query.test.js tests/explorer-state.test.js tests/preferences.test.js tests/pipeline.test.js`

Expected: PASS。

```bash
git add js/explorer-state.js js/explorer.js js/query.js js/preferences.js tests/explorer-state.test.js tests/query.test.js tests/preferences.test.js
git commit -m "refactor: drive query filters and sorting from metadata"
```

### Task 5: 聚合结果与 year-stack 页面重构

**Files:**
- Modify: `index.html`
- Create: `js/results-view.js`
- Create: `js/year-stack.js`
- Modify: `js/render.js`
- Modify: `js/app.js`
- Modify: `css/layout.css`
- Modify: `css/query.css`
- Create: `tests/results-view.test.js`
- Modify: `tests/render.test.js`

**Interfaces:**
- Consumes: Task 3 的 `MajorAggregate[]`；Task 4 的状态和 dispatch。
- Produces: `renderResultWorkspace(root, model, metadata, dispatch)`；`buildYearSummaryHtml(yearAggregate)`；`buildSchoolDetailHtml(schoolAggregate)`。

- [ ] **Step 1: 写聚合结果 HTML 失败测试**

断言本科专业摘要包含填报代号、公共课、专业基础课/代码和三年省控线；年份摘要同时包含公办/民办学校数、普通人数和建档立卡人数。

- [ ] **Step 2: 写延迟院校 DOM 失败测试**

断言初始 HTML builder 的结果不含电话/地址等学校详情；单独调用年份/院校 builder 后才生成详情，同校普通和专项显示在同一院校块。事件委托的真实展开流程留到 Task 8 浏览器验收，避免为了 DOM 测试引入新框架。

- [ ] **Step 3: 运行渲染测试确认失败**

Run: `node --test tests/results-view.test.js tests/render.test.js`

Expected: FAIL，提示新 view 接口不存在。

- [ ] **Step 4: 重构查询页信息架构**

在 `index.html` 固定搜索、查询上下文、筛选、排序操作、聚合结果、预览、导出顺序；保留 data analysis/about 页签和 aria 标签。

- [ ] **Step 5: 拆分 result 和 year-stack 渲染**

把 `js/render.js` 的聚合摘要迁到 `js/results-view.js`，院校/年份迁到 `js/year-stack.js`；使用一个根节点事件委托处理展开、重试和链接操作。

- [ ] **Step 6: 完成响应式样式与状态文案**

桌面使用紧凑表格/摘要行，小屏使用可换行摘要与横向滚动预览；分别实现 loading、查询空、筛选空、年份无数据和加载失败状态。

- [ ] **Step 7: 运行测试并提交**

Run: `node --test tests/results-view.test.js tests/render.test.js tests/query.test.js`

Expected: PASS。

```bash
git add index.html js/results-view.js js/year-stack.js js/render.js js/app.js css/layout.css css/query.css tests/results-view.test.js tests/render.test.js
git commit -m "feat: build aggregated query workspace"
```

### Task 6: 预览、分页与导出同源

**Files:**
- Modify: `js/preview.js`
- Modify: `js/export.js`
- Modify: `js/explorer.js`
- Modify: `css/preview.css`
- Modify: `tests/preview.test.js`
- Modify: `tests/export.test.js`
- Modify: `tests/integration.test.js`

**Interfaces:**
- Consumes: Task 3 的 `projectPreviewRows` 与 Task 1 的展开字段。
- Produces: `createPreviewModel(aggregates, metadata, state)`；`serializeCsv(rows, fields)`；`prepareExport(repository, state)`。

- [ ] **Step 1: 写年度模板列失败测试**

在 `tests/preview.test.js` 使用 2027 fixture，断言无需改代码即出现 2027 省控线、院校数、普通计划和建档立卡计划列，并包含公共课与专业基础课列。

- [ ] **Step 2: 写分页导出一致性失败测试**

在 `tests/integration.test.js` 生成超过一页的结果，断言 preview model 的完整 rows、CSV 行序、列序和值相同，当前页只影响 HTML。

- [ ] **Step 3: 写空数据和缺失年份失败测试**

断言筛选后无行时导出禁用；某个必需年份加载失败时导出返回明确原因，不生成部分年份但文件名看似完整的 CSV。

- [ ] **Step 4: 运行预览与导出测试确认失败**

Run: `node --test tests/preview.test.js tests/export.test.js tests/integration.test.js`

Expected: FAIL，提示年度列或 `prepareExport` 不存在。

- [ ] **Step 5: 统一 preview/export 字段与 formatter**

让 `js/preview.js` 和 `js/export.js` 都读取 `getPreviewFields(expandedMetadata)` 与 `formatFieldValue(row, field)`；移除任何单独的 CSV 值拼装。

- [ ] **Step 6: 导出前按需确保数据完整**

`prepareExport(repository, state)` 等待预览所需年份数据，成功后用完整 rows 生成 CSV；加载中禁用按钮并显示正在准备的年份。

- [ ] **Step 7: 运行测试并提交**

Run: `node --test tests/preview.test.js tests/export.test.js tests/integration.test.js`

Expected: PASS。

```bash
git add js/preview.js js/export.js js/explorer.js css/preview.css tests/preview.test.js tests/export.test.js tests/integration.test.js
git commit -m "refactor: keep aggregated preview and export identical"
```

### Task 7: 懒加载图表、错误恢复与清除状态

**Files:**
- Modify: `index.html`
- Modify: `js/app.js`
- Modify: `js/stats.js`
- Modify: `js/data-source.js`
- Modify: `js/preferences.js`
- Create: `tests/loading.test.js`
- Modify: `tests/preferences.test.js`
- Modify: `tests/integration.test.js`

**Interfaces:**
- Consumes: Task 2 repository 的 per-source loading/error/retry 状态。
- Produces: `ensureChartsLoaded(documentLike) -> Promise<boolean>`；`clearUiPreferences(storage, metadata) -> ExplorerState`；年份级 retry action。

- [ ] **Step 1: 写首屏资源请求失败测试**

在 `tests/loading.test.js` 断言 bootstrap 完成搜索可用状态时未请求 ECharts、任何 planSource 或非默认年份 mapping；打开统计页后才加载 ECharts。

- [ ] **Step 2: 写历史年份失败隔离测试**

断言 2025 plan 失败不清空 2026 聚合结果；该年份 retry 成功后只更新 2025，不重复请求已缓存资源。

- [ ] **Step 3: 写清除存储失败测试**

断言清除全部 localStorage 后主题为 auto、筛选/排序/列宽/页码恢复默认，而 repository 内存缓存仍可使用且不会写回业务数据。

- [ ] **Step 4: 运行加载与恢复测试确认失败**

Run: `node --test tests/loading.test.js tests/preferences.test.js tests/integration.test.js`

Expected: FAIL，提示图表 loader、retry 或清除接口不存在。

- [ ] **Step 5: 移除同步 ECharts 并实现动态加载**

从 `index.html` 删除首屏 ECharts script；在 `js/stats.js` 实现单例 `ensureChartsLoaded(documentLike)`，失败时调用现有表格降级且允许再次进入时重试。

- [ ] **Step 6: 实现年份级错误恢复和完整清除**

把 repository 错误映射为年份区域的可重试状态；清除按钮调用 `localStorage.clear()`、重置 explorer/theme/preview，不重新创建 repository。

- [ ] **Step 7: 运行测试并提交**

Run: `node --test tests/loading.test.js tests/preferences.test.js tests/integration.test.js tests/data.test.js`

Expected: PASS。

```bash
git add index.html js/app.js js/stats.js js/data-source.js js/preferences.js tests/loading.test.js tests/preferences.test.js tests/integration.test.js
git commit -m "perf: lazy load yearly plans and analytics"
```

### Task 8: 文档、2027 演练与全量验收

**Files:**
- Modify: `README.md`
- Modify: `转换说明.md`
- Modify: `tests/fixtures/metadata-2027.json`
- Modify: `tests/fixtures/mapping-2027.json`
- Modify: `tests/fixtures/scores-2027.json`
- Modify: `tests/fixtures/plans-2027.json`
- Modify: `tests/integration.test.js`

**Interfaces:**
- Consumes: Task 1–7 的最终公开接口。
- Produces: 可复现的年度接入说明、性能请求清单和完整验收证据。

- [ ] **Step 1: 扩展 2027 数据-only 演练测试**

在 fixture metadata 只声明 2027 sources 和字段模板，断言搜索、聚合、筛选、排序、预览、文件名和 CSV 均包含 2027，且没有读取源码中的 `2026` 特例。

- [ ] **Step 2: 更新用户与维护文档**

README 说明聚合展示、筛选语义、普通/专项分别统计、懒加载阶段、localStorage 白名单和新增年份步骤；`转换说明.md` 增加查询索引生成及源数据 schema 检查。

- [ ] **Step 3: 运行全量自动测试**

Run: `npm test`

Expected: 所有测试 PASS，无 skipped/failed。

- [ ] **Step 4: 运行静态年份硬编码检查**

Run: `rg -n "2024|2025|2026" js --glob "*.js"`

Expected: 业务模块无年份分支；仅允许示例文案或明确记录的迁移兼容注释。

- [ ] **Step 5: 浏览器验收关键流程**

使用本地 HTTP 服务验证：模糊词回车补全；公共课/专业基础课筛选；公办+建档立卡组合；同校普通/专项合并；历史年份展开加载；预览分页；CSV 与预览一致；清除存储；小屏横向滚动；统计页图表懒加载。

- [ ] **Step 6: 记录性能请求验收**

在浏览器网络面板确认：首屏仅 metadata + query index；查询后才加载 mapping/default score/default plan；历史 plan 按需；ECharts 仅统计页；同 URL 不重复请求。

- [ ] **Step 7: 提交文档与验收 fixture**

```bash
git add README.md 转换说明.md tests/fixtures tests/integration.test.js
git commit -m "docs: document aggregated yearly data workflow"
```

- [ ] **Step 8: 完成分支审查**

按 `superpowers:requesting-code-review` 审查最终 diff，重点核对数据口径、预览导出同源、localStorage 边界和 2027 data-only 演练；发现问题修复后重新运行 `npm test`。
