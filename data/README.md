# 数据目录

本目录按数据类型组织，类型目录内的规范 JSON 和官方 PDF 均以年份命名。除一分一段每年包含多份专业 PDF 外，不再以年份作为目录层级。

`source-registry.json` 是离线工具共享的数据源注册表，集中声明输出 JSON、输入 PDF、解析器、年份和官方预期行数。Python 工具读取该文件，不再重复硬编码文件名。

| 目录 | 权威字段 | 规范数据 | 官方原始文件 |
| --- | --- | --- | --- |
| `专业对照/` | 专业代码、专业名称、考试科目 | `专业对照_<年份>.json` | `原始PDF/*.pdf` |
| `省控线/` | 专业年度录取控制分数线 | `省控线_<年份>.json` | `原始PDF/省控线_<年份>.pdf` |
| `招生计划/` | 院校、招生专业、计划人数、学费等 | `招生计划_<年份>.json` | `原始PDF/招生计划_<年份>.pdf` |
| `招生高校及专业/` | 招生计划缺失字段的回退信息 | `招生高校及专业_<年份>.json` | `原始PDF/招生高校及专业_<年份>.pdf` |
| `一分一段/` | 分数、累计人数 | `一分一段_<年份>.json` | `原始PDF/<年份>/*.pdf` |
| `来源清单/` | 来源页面、下载 URL、哈希和转换状态 | `来源清单_<年份>.json` | 不适用 |
| `reports/` | 转换异常与字段冲突 | `转换报告_<年份>.json` | 不适用 |
| `schemas/` | 数据契约 | `*.schema.json` | 不适用 |

## 来源和冲突规则

原始 PDF 不做原位修改。转换工具只写规范 JSON 与报告，并用来源清单中的相对路径和 SHA-256 建立追溯关系。

重复字段按官方文件职责确定权威值：专业字段以专业对照表为准，省控线以录取控制分数线为准，院校和计划字段以招生计划表为准，分数及累计人数以一分一段表为准。招生高校及专业总表仅补充缺失值。冲突必须进入转换报告，不得静默覆盖。

## 新增年度的发布清单

先完成来源清单、原始 PDF、转换报告和规范 JSON 的核对，再运行 `python -m convert.refresh_catalog`。工具扫描每年的专业对照、省控线、招生计划、一分一段和转换报告，核对年份、专业代号、控制线、计划和 PDF 来源哈希，然后在 `generated/<年份>/<输入摘要>/` 生成 analytics、专业分片和索引，在 `generated/catalog/` 生成含输入 SHA-256 的版本化索引表。analytics 保留每个专业的控制线，以及按办学性质汇总的院校、普通/专项计划和轻量的逐校汇总，以支持查询预览时准确去重；院校逐条招生计划仍在展开详情后读取。所有生成物校验通过后，最后原子替换 `metadata/school-data.json`。旧版本文件保持不变，所以中途失败不会改变旧页面的数据入口。旧年度借用其他年份对照须在 `metadata/school-data.template.json` 的 `mappingReferences` 中明确声明；新增年份必须有该年自己的专业对照。2024、2025 暂借用 2026 对照。

页面的年份弹窗、聚合卡片、表格列、预览和 CSV 都从 metadata 的年份集合读取。不要通过复制页面字段或修改 JS 来“接入”新年度；数据文件和 metadata 才是年度边界。业务原始数据、转换产物和查询结果也不得写入浏览器 localStorage。
# Adding a year

Create `data/year-links/YYYY.json` with the official search page and any known exact announcement or attachment URLs. A source entry uses one of these six roles: `scoreSegments`, `scorelines`, `plans`, `mappingCodeTable`, `mappingOverview`, or `master`; each role accepts `pageUrl` and `attachmentUrl`. The resolver may fill a missing page from a unique official search result. It stops when the source is absent, ambiguous, inaccessible or does not match the requested year and type. The `master` role is the separate admissions college/major master list, not the detailed school plan table. Its PDF may be hosted on the verified `xcoss.henan.gov.cn` government attachment host.

Run the command in `convert/README.md` with `--check` first. Inspect the provenance and coverage report, correct the seed or OCR data as needed, then run without `--check` to publish. The process retains the existing yearly registry entries and metadata is replaced last. A duplicate year, inaccessible official page (including HTTP 412), missing attachment, unresolved OCR review, or conflicting existing canonical output stops publication; metadata remains the current pointer. Do not substitute an unofficial mirror or directly edit published generated indexes. Keep each year's own mapping; do not add a new year to `mappingReferences` as a fallback. See `convert/README.md` for review, retry, correction and rollback steps.
