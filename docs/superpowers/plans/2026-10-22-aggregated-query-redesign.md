# 河南专升本数据治理与聚合查询 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 PDF/JSON 按数据类型规范迁入 `data/`，批量采集并转换 2024–2026 官方一分一段表，再把省控线、招生计划、考试科目和参考位次接入 metadata 驱动的聚合查询、预览与导出。

**Architecture:** `crawler/` 发现和下载官方文件，`convert/` 使用 `pdfplumber` 抽取、归一化、校验并生成字节稳定的年度 JSON；原始 PDF、来源清单、转换报告和前端数据都保存在按数据类型划分的 `data/`。浏览器只消费验证后的 JSON，通过懒加载 repository 构建专业—年份—院校聚合模型，筛选、预览和 CSV 共用同一结果对象。

**Tech Stack:** Python 3.11、`requests`、`beautifulsoup4`、`pdfplumber`、原生 HTML/CSS、ES Modules、Node.js `node:test`、Ajv JSON Schema

**Spec:** `docs/superpowers/specs/2026-10-22-aggregated-query-redesign-design.md`

## Global Constraints

- 数据顶层按类型分目录，目录内产物按年份命名；不得改成 `data/<year>/...`。
- 现有受版本控制文件必须用 `git mv` 迁移，不能删除后重建。
- 官方原始 PDF 不做原位修改；转换结果只能写入对应数据类型目录的 JSON 和 `data/reports/`。
- 2024–2026 一分一段必须来自河南省教育考试院公开页面或其官方文件域名，非官方聚合站只能用于发现线索。
- 专业字段以专业对照表为准，省控线以录取控制分数线为准，院校和计划字段以招生计划表为准，分数累计人数以一分一段表为准。
- 冲突不得静默覆盖；报告必须记录来源原值、采用值和采用依据。
- 数据流水线固定为“原始数据 → 归一化 → 聚合 → 筛选 → 排序 → 预览表格 → 导出”。
- 导出消费完整预览结果和同一格式化器，不能读取当前分页 DOM。
- 原始数据、索引、聚合结果和筛选结果不得写入 localStorage。
- 分数线称为“省控线”；一分一段人数称为“累计人数/参考位次”，不能称作唯一排名。
- 新增年份只增加数据文件和 metadata，不增加业务代码年份分支。

## Review Focus

- 官方页面返回反爬脚本、超时或部分链接：下载器失败并保留可重试状态，不能生成“成功”空清单；Task 2 覆盖。
- PDF 跨页、重复表头、空单元格或字符粘连：解析器去表头、合并合法行并报告不可判定行；Task 3 覆盖。
- 同一专业在不同官方表中的名称或代码冲突：采用字段权威表并报告全部原值和依据；Task 4 覆盖。
- 同校普通计划与建档立卡使用不同院校代码：学校只计一次、人数分别保留；Task 6 覆盖。
- 用户只查看预览第一页后导出：CSV 仍包含所有筛选排序行，且列序和值一致；Task 8 覆盖。

---

### Task 1: 使用 `git mv` 建立数据资产目录

**Files:**
- Move: `pdf/*.pdf` → `data/<数据类型>/原始PDF/<规范文件名>.pdf`
- Move: `data/分数线*.json` → `data/省控线/省控线_<年份>.json`
- Move: `data/招生计划*.json` → `data/招生计划/招生计划_<年份>.json`
- Move: `data/招生高校及专业2026.json` → `data/招生高校及专业/招生高校及专业_2026.json`
- Move: `data/专科专业可报本科专业对照.json` → `data/专业对照/专业对照_2026.json`
- Create: `data/README.md`
- Modify: `metadata/school-data.json`
- Modify: `tests/schema-validation.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: 当前受版本控制的 PDF/JSON 和 metadata 路径。
- Produces: 按数据类型组织的目录及仍可被现有页面加载的 `yearSources`。

- [ ] **Step 1: 写迁移路径失败测试**

在 `tests/schema-validation.test.js` 增加 `all metadata sources resolve inside typed data directories`，断言每个 source 存在且不直接位于 `data/` 根目录。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/schema-validation.test.js`

Expected: FAIL，指出当前根目录 JSON 路径。

- [ ] **Step 3: 用 `git mv` 迁移 PDF 和 JSON**

逐个执行 `git mv <旧路径> <新路径>`；一分一段之外的 `原始PDF/` 不再按年份建子目录。更新 metadata 路径，不改数据内容。

- [ ] **Step 4: 写目录说明并验证**

`data/README.md` 记录每个目录的权威字段、原始/规范文件命名和来源追溯规则。

Run: `git diff --summary`

Expected: 主要文件显示 `rename`。

Run: `npm test`

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add data metadata/school-data.json tests/schema-validation.test.js README.md
git commit -m "refactor: organize source data by dataset"
```

### Task 2: 官方来源发现与三年批量下载

**Files:**
- Create: `crawler/requirements.txt`
- Create: `crawler/discover.py`
- Create: `crawler/download.py`
- Create: `crawler/source_rules.py`
- Create: `crawler/README.md`
- Create: `crawler/tests/test_discover.py`
- Create: `crawler/tests/test_download.py`
- Create: `data/来源清单/来源清单_2024.json`
- Create: `data/来源清单/来源清单_2025.json`
- Create: `data/来源清单/来源清单_2026.json`

**Interfaces:**
- Consumes: `discover_year(year: int, page_url: str, html: str | None = None) -> list[SourceEntry]`。
- Produces: `download_manifest(manifest_path: Path, data_root: Path, session: requests.Session) -> DownloadReport`；`SourceEntry` 包含 `year/sourcePageUrl/pdfUrl/localPath/majorCode/majorName`。

- [ ] **Step 1: 写来源发现失败测试**

fixture 覆盖相对/绝对 PDF 链接、URL 编码中文、重复链接、非官方域名和反爬脚本页；断言只保留官方 PDF、按专业代码稳定排序，反爬页抛出 `DiscoveryBlockedError`。

- [ ] **Step 2: 写下载失败测试**

断言成功下载计算 SHA-256；哈希一致时跳过；HTTP 失败、非 PDF 内容和中断下载不覆盖已有有效文件。

- [ ] **Step 3: 运行测试确认失败**

Run: `python -m unittest discover -s crawler/tests -v`

Expected: FAIL，模块尚不存在。

- [ ] **Step 4: 实现发现和下载器**

`discover.py` 解析官方列表页或显式保存的官方 HTML；`download.py` 使用 `.part` 临时文件完成后原子重命名，输出 HTTP 状态、SHA-256、字节数和 `downloadStatus`。

- [ ] **Step 5: 生成并下载 2024–2026 清单**

Run: `python crawler/discover.py --years 2024 2025 2026 --output data/来源清单`

Run: `python crawler/download.py --manifests data/来源清单 --data-root data`

Expected: PDF 写入 `data/一分一段/原始PDF/<year>/`；成功条目有 SHA-256，失败条目有原因。

- [ ] **Step 6: 复跑验证幂等性并提交**

第二次运行跳过哈希一致文件且不改变稳定字段。

```bash
git add crawler data/来源清单 data/一分一段/原始PDF
git commit -m "data: download official score segment PDFs"
```

### Task 3: 使用 `pdfplumber` 批量抽取一分一段

**Files:**
- Create: `convert/requirements.txt`
- Create: `convert/pdf_tables.py`
- Create: `convert/score_segments.py`
- Create: `convert/convert_all.py`
- Create: `convert/README.md`
- Create: `convert/tests/test_pdf_tables.py`
- Create: `convert/tests/test_score_segments.py`
- Create: `convert/tests/fixtures/score-segment-sample.pdf`

**Interfaces:**
- Consumes: `extract_rows(pdf_path: Path) -> list[RawPdfRow]`。
- Produces: `parse_score_segments(rows: Iterable[RawPdfRow]) -> tuple[list[ScoreSegment], list[ParseIssue]]`；`ScoreSegment(score: int, cumulativeCount: int)`。

- [ ] **Step 1: 写跨页和重复表头失败测试**

断言多页合并为一组分数段，重复表头被忽略，数字空格可归一化，无法识别行进入 `ParseIssue`。

- [ ] **Step 2: 写业务单调性失败测试**

断言分数重复、非降序或累计人数随分数下降反而减少时解析失败，不输出部分成功专业。

- [ ] **Step 3: 运行测试确认失败**

Run: `python -m unittest discover -s convert/tests -v`

Expected: FAIL，模块尚不存在。

- [ ] **Step 4: 实现 `pdfplumber` 抽取与纯解析器**

`pdf_tables.py` 只负责 PDF 单元格和页码；`score_segments.py` 负责表头识别、整数转换、排序和问题记录，不联网、不读取 metadata。

- [ ] **Step 5: 实现全量/单年入口并验证**

`convert_all.py --dataset score-segments [--year YEAR]` 从来源清单读取成功 PDF，为每个专业生成结果和异常集合。

Run: `python -m unittest discover -s convert/tests -v`

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add convert
git commit -m "feat: extract score segments with pdfplumber"
```

### Task 4: 权威字段归一化、Schema 和冲突报告

**Files:**
- Create: `convert/authority.py`
- Create: `convert/normalize.py`
- Create: `convert/validate.py`
- Create: `convert/tests/test_authority.py`
- Create: `convert/tests/test_validate.py`
- Create: `data/schemas/score-segments.schema.json`
- Create: `data/schemas/source-manifest.schema.json`
- Create: `data/一分一段/一分一段_2024.json`
- Create: `data/一分一段/一分一段_2025.json`
- Create: `data/一分一段/一分一段_2026.json`
- Create: `data/reports/转换报告_2024.json`
- Create: `data/reports/转换报告_2025.json`
- Create: `data/reports/转换报告_2026.json`
- Modify: `tests/schema-validation.test.js`

**Interfaces:**
- Consumes: Task 3 分数段、专业对照/省控线/招生计划数据和来源清单。
- Produces: `resolve_field(field: str, candidates: list[SourceValue]) -> Resolution`；`validate_score_segment_year(document: object) -> ValidationReport`。

- [ ] **Step 1: 写权威来源失败测试**

覆盖专业名称、计划人数和累计人数冲突、fallback 补空值及无明确优先级冲突；Resolution 必须含采用值、来源和理由，未定义冲突阻止发布。

- [ ] **Step 2: 写 Schema/业务验证失败测试**

断言专业代码唯一、segments 非空、分数严格降序、累计人数单调不减、sourceId 可回溯；PDF 缺失或哈希不一致时失败。

- [ ] **Step 3: 实现归一化与确定性写入**

JSON 使用 UTF-8、固定字段顺序、专业代码排序、`indent=2` 和单个结尾换行；易变下载时间不写业务 JSON。

- [ ] **Step 4: 生成三年数据并验证字节稳定**

Run: `python convert/convert_all.py --dataset score-segments --years 2024 2025 2026`

Expected: 三年 JSON 通过 Schema，未解决冲突为 0。

连续运行两次后：`git diff --exit-code -- data/一分一段 data/reports` 成功。

- [ ] **Step 5: 运行测试并提交**

Run: `python -m unittest discover -s convert/tests -v`

Run: `node --test tests/schema-validation.test.js`

Expected: 全部 PASS。

```bash
git add convert data/schemas data/一分一段/*.json data/reports tests/schema-validation.test.js
git commit -m "data: normalize and validate score segment data"
```

### Task 5: metadata v2 和懒加载数据仓库

**Files:**
- Modify: `metadata/school-data.json`
- Modify: `metadata/school-data.schema.json`
- Modify: `js/metadata.js`
- Create: `js/data-source.js`
- Create: `js/model.js`
- Modify: `js/data.js`
- Modify: `tests/metadata.test.js`
- Modify: `tests/data.test.js`
- Create: `tests/model.test.js`

**Interfaces:**
- Consumes: Task 1 新路径与 Task 4 的 `scoreSegmentSource`。
- Produces: `expandMetadata(metadata)`；`createDataRepository(metadata, fetchImpl)`；`repository.ensureScoreSegments(year)`；规范 `MajorOption/PlanEntry/ScoreSegmentSeries`。

- [ ] **Step 1: 写 metadata、请求阶段和归一化失败测试**

断言每个年份声明一分一段源；新增 2027 只改 fixture；首屏不请求计划/一分一段；同 URL 共享 Promise；空白、全角括号、`T/K` 后缀正确处理，缺失值保持 `null`。

- [ ] **Step 2: 实现 metadata 展开和 repository**

repository 使用内存 `Map<string, Promise<unknown>>`，公开 `ensureMapping/ensureScores/ensurePlans/ensureScoreSegments/retry`，不写 localStorage。

- [ ] **Step 3: 运行测试并提交**

Run: `node --test tests/metadata.test.js tests/data.test.js tests/model.test.js tests/schema-validation.test.js`

Expected: 全部 PASS。

```bash
git add metadata js/metadata.js js/data-source.js js/model.js js/data.js tests
git commit -m "refactor: load typed yearly data from metadata"
```

### Task 6: 聚合领域模型与统一筛选排序管线

**Files:**
- Create: `js/aggregate.js`
- Modify: `js/pipeline.js`
- Create: `js/explorer-state.js`
- Modify: `js/query.js`
- Modify: `tests/aggregate.test.js`
- Modify: `tests/pipeline.test.js`
- Modify: `tests/query.test.js`
- Create: `tests/explorer-state.test.js`

**Interfaces:**
- Consumes: Task 5 领域对象和展开 metadata。
- Produces: `buildMajorAggregates(input) -> MajorAggregate[]`；`resolveScoreContext(series, score, controlScore)`；`reduceExplorerState(state, event, metadata)`。

- [ ] **Step 1: 写学校、计划和一分一段聚合失败测试**

同校普通代码 `6001`、专项代码 `6401` 合并但人数分开；public/private 院校数去重；fallback 不增加计划；省控线/用户分数累计人数和分差正确，缺失分数返回 `null`。

- [ ] **Step 2: 写查询筛选失败测试**

覆盖回车补全、公办/民办、普通/建档立卡、公共课、专业基础课、分数范围、院校数、非法分数和 metadata 排序。

- [ ] **Step 3: 实现纯聚合和 reducer**

不得引用 DOM、localStorage 或硬编码年份；固定 aggregate → filter → sort → project preview。

- [ ] **Step 4: 运行测试并提交**

Run: `node --test tests/aggregate.test.js tests/pipeline.test.js tests/query.test.js tests/explorer-state.test.js`

Expected: 全部 PASS。

```bash
git add js/aggregate.js js/pipeline.js js/explorer-state.js js/query.js tests
git commit -m "feat: aggregate schools plans and score segments"
```

### Task 7: 聚合查询页面和 year-stack

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
- Consumes: Task 6 的 `MajorAggregate[]` 和 explorer state。
- Produces: `renderResultWorkspace(root, model, metadata, dispatch)`；`buildYearSummaryHtml(yearAggregate)`；`buildSchoolDetailHtml(schoolAggregate)`。

- [ ] **Step 1: 写摘要和延迟详情失败测试**

摘要包含专业代码、公共课、专业课、三年省控线、参考位次、公/民院校数和普通/专项人数；初始 HTML 不含电话地址，展开后才生成院校详情和分数段表。

- [ ] **Step 2: 重构页面和状态**

固定搜索、上下文、筛选、排序、聚合结果、预览、导出顺序；统一事件委托；区分查询无匹配、筛选无结果、年份未发布和加载失败；小屏可横向滚动。

- [ ] **Step 3: 运行测试并提交**

Run: `node --test tests/results-view.test.js tests/render.test.js`

Expected: 全部 PASS。

```bash
git add index.html js/results-view.js js/year-stack.js js/render.js js/app.js css tests
git commit -m "feat: render aggregated yearly query workspace"
```

### Task 8: 预览、分页、CSV 和状态清理

**Files:**
- Modify: `js/preview.js`
- Modify: `js/export.js`
- Modify: `js/preferences.js`
- Modify: `js/explorer.js`
- Modify: `css/preview.css`
- Modify: `tests/preview.test.js`
- Modify: `tests/export.test.js`
- Modify: `tests/preferences.test.js`
- Modify: `tests/integration.test.js`

**Interfaces:**
- Consumes: Task 6 完整筛选排序结果。
- Produces: `createPreviewModel(aggregates, metadata, state)`；`serializeCsv(rows, fields)`；`prepareExport(repository, state)`；`clearUiPreferences(storage, metadata)`。

- [ ] **Step 1: 写预览导出一致性和清理失败测试**

超过一页时 CSV 包含全部结果；字段、列序和值与 preview model 一致；无数据/年份失败时禁用；清空 localStorage 后 UI 默认但 repository 缓存仍可用。

- [ ] **Step 2: 统一 formatter 并实现导出**

预览与 CSV 共用 `getPreviewFields`/`formatFieldValue`；文件名含年份和日期；分页只影响渲染切片。

- [ ] **Step 3: 运行测试并提交**

Run: `node --test tests/preview.test.js tests/export.test.js tests/preferences.test.js tests/integration.test.js`

Expected: 全部 PASS。

```bash
git add js/preview.js js/export.js js/preferences.js js/explorer.js css/preview.css tests
git commit -m "refactor: keep preview export and UI state consistent"
```

### Task 9: 文档、年度演练与全量验收

**Files:**
- Modify: `README.md`
- Modify: `转换说明.md`
- Modify: `data/README.md`
- Modify: `tests/fixtures/metadata-2027.json`
- Modify: `tests/integration.test.js`

**Interfaces:**
- Consumes: Task 1–8 的最终接口和数据产物。
- Produces: 数据更新手册、2027 data-only 演练和最终验收证据。

- [ ] **Step 1: 完成 2027 data-only 演练测试**

fixture 只增加 2027 metadata/data，断言查询、聚合、筛选、参考位次、预览和 CSV 工作，`js/` 无业务年份分支。

- [ ] **Step 2: 更新维护文档**

记录目录规则、官方来源优先级、爬取/转换命令、异常处理、Schema、冲突审批、metadata 年度接入和 localStorage 边界。

- [ ] **Step 3: 运行完整验证**

Run: `python -m unittest discover -s crawler/tests -v`

Run: `python -m unittest discover -s convert/tests -v`

Run: `npm test`

Run: `python convert/validate.py --all --data-root data`

Expected: 全部 PASS，无 skipped/failed，三年来源/哈希/Schema/冲突检查通过。

- [ ] **Step 4: 浏览器验收**

验证回车补全、专业课筛选、公/民与普通/专项聚合、三年省控线和参考位次、院校展开、分页、CSV、清除存储、小屏滚动和失败重试。

- [ ] **Step 5: 提交并最终审查**

```bash
git add README.md 转换说明.md data/README.md tests/fixtures tests/integration.test.js
git commit -m "docs: document official data update workflow"
```

使用 `superpowers:requesting-code-review` 审查完整分支；修复后重新运行三套完整测试。
