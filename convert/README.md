# 官方数据转换

转换层只读取 `data/year-links/YYYY.json` 的年度身份与官方来源链接。清单、PDF、提取、规范数据和报告路径由共享构造器按年份派生，不在多个 CLI 或 JSON 文件中重复维护。

一分一段 PDF 没有文本层，是整页扫描图。流水线先由 `pdfplumber` 读取页码和内嵌图片，再由 RapidOCR 识别表格数字，最后通过纯解析器检查分数唯一性及累计人数单调性。快速识别违反约束时会自动逐单元格重试；仍无法确认的数字写入 `issues`，不会被静默补造。OCR 并发默认读取根目录 `pipeline_config.py`，CLI `--workers` 可临时覆盖。多进程按完成顺序显示进度，但年度索引仍按来源清单顺序保存。流式消费有利于及时显示结果和减少待处理对象，OCR 耗时仍主要由图像识别决定。

省控线、招生计划、专业对照和招生高校表由 `scanned_tables.py` 优先读取 PDF 文本表格；只有页面没有文本表格时，才按扫描图上的表格线定位单元格并调用 RapidOCR。`sources.py` 解析字段，`source_references.py` 用年度来源清单校正 OCR 误读的代码与名称。招生计划的可选列按实际表格宽度识别，不按年份硬编码。扫描结果仍需核对行数、专业代码和跨表一致性；OCR 不能确认的数据不得当作空值通过。

依赖见 `convert/requirements.txt`。所有命令从仓库根目录用 `python -m convert.<模块>` 调用；`--help` 可查看当前参数。各入口的主要参数如下：

| 模块 | 参数 | 用途 |
| --- | --- | --- |
| `convert_all` | `--year YYYY`（可重复） | 限定转换年度；省略时处理所有 seed 年度。 |
| `convert_all` | `--major CODE`（可重复） | 只转换指定专业，保留同年其他分片。代号必须在来源清单中。 |
| `convert_all` | `--retry-review` | 只重试现有索引中 `needs-review` 的专业；不可与 `--major` 同用。 |
| `convert_all` | `--verbose` | 默认每完成约 5% 打印一次进度，并立即列出待审专业；加此项显示每个专业的完成状态。 |
| `convert_all` | `--workers N` | 覆盖 `pipeline_config.py` 的 OCR 进程数。 |
| `convert_all` | `--dataset NAME`、`--data-root PATH` | 指定数据集（当前为 `score-segments`）和数据根目录。 |
| `issue_reports` | `--years YYYY …`、`--full-report` | 限定年份；默认只保留可疑 OCR 行及上下文，完整 OCR 行仅在完整报告中写入。 |
| `refresh_catalog` | `--data-root PATH`、`--template PATH`、`--metadata PATH` | 校验最终规范分片和转换报告，刷新 catalog。 |
| `segment_store` | `--year YYYY --output NEW_PATH` | 核对规范索引和分片哈希后导出合并副本；拒绝覆盖已有路径。 |
| `ingest_year` | `--seed YEAR_LINKS --check` | 在暂存目录核验新年度，不发布。 |
| `ingest_year` | `--export-dir PATH` | 仅与 `--check` 同用；导出核验通过的新年度原始来源、规范表和转换结果，供合并后的可信发布任务复用。 |
| `ingest_year` | `--full-report` | 默认输出导入摘要和异常；加此项显示来源溯源与逐专业明细。 |
| `crawler.download` | `--major CODE`（可重复） | 只下载或重试指定专业的官方 PDF，可与年份筛选一起使用。 |
| 各入口 | `--data-root PATH` | 改用指定数据根目录，适合隔离演练。 |

一分一段只有一套持久化分片：年度索引 `一分一段/一分一段_<年份>.json` 和专业文件 `一分一段/<年份>/<专业代号>.json`。`convert_all` 在内存中完成 OCR 和归一化，只写一次最终规范分片及转换报告；`issue_reports` 应用确认修正时复用同一写入入口。独立的 `normalize` 命令已移除，复核已有数据直接运行 `refresh_catalog`。写入先落到临时文件再原子替换；内容不变时不改写。索引的 `sha256` 是分片内容哈希，仅在内容变化时更新；分片里的 `sourceSha256` 是官方 PDF 哈希。`needs-review` 保留在同一分片和索引中，但不会进入浏览器展示。单专业 `--major` 只重算该专业，`--retry-review` 只重算索引里待审的专业；两者不能同时使用。日志含完成数、专业代号和名称、错误码及原因。

`refresh_catalog` 从规范招生计划生成按院校代码区分的年度分析摘要。变更摘要派生规则时需更新 `DERIVATION_VERSION`，再运行 `python -m convert.refresh_catalog`，将新版本的 `data/generated/` 文件与更新后的 `metadata/school-data.json` 一同提交。旧版本文件保持不可变；专项标注和筛选口径见 [数据目录说明](../data/README.md#建档立卡专项与院校代码)。

`generated/<年份>/<16位哈希>/analytics.json` 的目录名是年度版本：对规范映射、省控线、招生计划、一分一段索引、转换报告的规范 JSON 内容哈希和派生规则版本再计算 SHA-256，取前 16 位。`generated/catalog/<16位哈希>.json` 的文件名是整份目录清单的版本：清单含各年发布路径、完整输入哈希及来源清单的来源身份哈希，序列化后计算 SHA-256 并取前 16 位。规范 JSON 内容哈希不受键顺序、缩进或换行符影响；来源身份哈希还忽略 `downloadStatus`，但来源 URL、专业与 PDF 哈希变化仍会改变它。因此来源清单或其他年度变化可能只改变 catalog 的哈希；这两段短哈希也都不是 `analytics.json` 文件本身的校验和。各输入的完整校验值在 catalog 的 `inputSha256` 中。

合并命令仅用于临时导出，不参与处理链；日常转换、复核、重试和 catalog 都使用同一套规范分片。

批量转换、异常报告、爬取和 catalog 均从 `data/year-links/*.json` 构建同一年度计划，再按年份过滤，不扫描 seed 未声明的来源。分数段来源尚未发布或 seed 未声明时，不会创建抓取目标；本地已有表格 PDF/规范数据仍可供离线转换入口使用。分数段归一化还需要省控线与招生计划 JSON：全量转换会报告并跳过缺少这些输入的年度，继续处理其他完整年份；如果所有年度都缺输入，则不启动 OCR 并返回失败。官方站 HTTP 请求通过同一个线程安全会话串行执行，下载默认 1 个线程；OCR 进程数仍独立配置。

异常报告写入 `data/reports/异常数据_<年份>.json`，默认保留错误、可疑 OCR 行及上下文；只有 `issue_reports --full-report` 才附带每个待审专业的完整 OCR 行。人工核对规则见 `data/reports/README.md`。`data/一分一段/人工修正.json` 只初始化一次，不会被报告生成器覆盖。确认修正后重新运行 `python -m convert.issue_reports`：它只复核待审专业，将 `status: confirmed` 的修正直接应用并覆盖对应规范分片；`official-empty` 不作为待审异常，也不会生成分数段。年度全量转换也会跳过标注为 `official-empty` 的 OCR 任务，并在进度里显示该状态，而不是显示原始识别的 `needs-review`。这样无需重跑全量 OCR 或再次运行 `normalize`。

## 已有年度复核

`ingest_year` 仅用于新增年度，`--seed` 必须是单个 `data/year-links/YYYY.json` 文件；它会拒绝覆盖已有年度。复核 2024–2026 等已发布年份时，不要运行 `convert_all` 或 `ingest_year`。可在仓库根目录用 PowerShell 将 `data/` 和 metadata 复制到临时目录，再依次复核异常并刷新 catalog：

```powershell
$verifyData = Join-Path $env:TEMP ("henan-shengben-verify-" + [guid]::NewGuid().ToString("N"))
Copy-Item data $verifyData -Recurse
New-Item -ItemType Directory -Path "$verifyData/metadata" -Force | Out-Null
Copy-Item metadata/school-data.json "$verifyData/metadata/school-data.json"
$years = @(2024, 2025, 2026)

python -m convert.issue_reports --years $years --data-root $verifyData
if ($LASTEXITCODE -ne 0) { throw "issue_reports 失败，停止复核" }
python -m convert.refresh_catalog --data-root $verifyData --template metadata/school-data.template.json --metadata "$verifyData/metadata/school-data.json"
```

`issue_reports` 没有 `--only-issues` 参数；它本身只会对索引中非 `ok` 的分片重新 OCR，并为选定年份写异常报告，确认修正会直接生成最终规范分片和转换报告。`refresh_catalog` 校验仍有阻塞项时会失败，只在通过后更新临时副本中的派生文件和 metadata。将 `$years` 改为需要检查的年份；每次执行会新建隔离目录，不会改动仓库正式数据。

转换报告写入 `reports/转换报告_<年份>.json`。默认只保留 catalog 校验所需的计数、阻塞项、异常解析、官方空表和来源未列出记录；`ingest_year --full-report` 才附带成功专业的逐条解析。归一化只发布 `status: ok` 且通过哈希、唯一性、严格降序和累计人数单调校验的专业。官方分数段清单未列出的代号会写入 `sourceUnavailable` 并附官方清单地址，不生成虚假分数段；catalog 只接受此类代号与省控线未覆盖清单完全一致。官方 PDF 明确为空表的情况仍通过人工文件的 `official-empty` 状态记录。

## 新年度链接导入

先创建 `data/year-links/YYYY.json`。`sources` 按以下六种角色声明官方公告页；每项可同时给出 `pageUrl` 和精确 `attachmentUrl`。一分一段的 PDF 仍由其公告页自动发现，其他来源在页面附件唯一时可省略精确链接。

```json
{
  "year": 2027,
  "searchPageUrl": "https://www.haeea.cn/govsearch?words=专升本&page=1",
  "sources": {
    "scoreSegments": {"pageUrl": "https://www.haeea.cn/..."},
    "scorelines": {"pageUrl": "https://www.haeea.cn/...", "attachmentUrl": "https://www.haeea.cn/...pdf"},
    "plans": {"pageUrl": "https://www.haeea.cn/..."},
    "mappingCodeTable": {"pageUrl": "https://www.haeea.cn/..."},
    "mappingOverview": {"pageUrl": "https://www.haeea.cn/...", "localPath": "专业对照/原始PDF/专业对照一览_2027.pdf"},
    "master": {"pageUrl": "https://www.haeea.cn/...", "attachmentUrl": "https://xcoss.henan.gov.cn/...pdf"}
  }
}
```

`ingest_year` 的 `--seed` 指向新年度链接配置；首次运行附加 `--check`，默认摘要包含来源数量、转换计数、阻塞项和 metadata diff。加 `--full-report` 可输出所有来源 URL、实际跳转 URL（如有）、哈希和逐专业解析。检查模式只在临时目录生成结果，不写入 `data/` 或 metadata。若分数段来源已发布，但省控线或招生计划来源尚未声明，导入会归档已找到的分数段来源并在摘要列出 `normalizationDeferred`，等待必需表格数据齐全后再归一化。人工确认后，本地去掉 `--check` 发布；已有年份会被拒绝，不能用此入口重跑覆盖。若发现官方网页返回 403/412、来源不唯一或缺附件，导入会失败且保留当前 metadata；先补齐或修正官方链接配置，再重试。当前入口要求官方公告页可读取；直接本地 PDF 离线导入尚未支持。`--export-dir` 为 GitHub Actions 导出受哈希清单约束的 artifact；它不改变 `--check` 的只读语义。PR 合并到 `main` 后，发布 job 校验 PR、seed 哈希及文件哈希，将规范数据放入仓库并重建 catalog/metadata；OCR 结果直接复用，不重跑 OCR。没有匹配的成功 artifact 时，主分支 seed push 会针对变更 seed 执行一次完整导入。

如果 seed 已在仓库且无需修改，在对应 PR 分支上手动运行 `Validate yearly data seed`，将 `seed_path` 设为 `data/year-links/YYYY.json`。必须选择 PR 当前 head 所在分支，并在合并前完成该次成功运行；合并后的 workflow 会用 PR head commit 找到 artifact、比对仓库和运行身份，再导入生成物。手动运行只接受尚未发布的年度 seed。此流程需在仓库 **Settings → Actions → General → Workflow permissions** 允许 read/write；发布 job 使用 GitHub 自动提供的短期 `GITHUB_TOKEN`，不需要 PAT 或自建密钥。主分支若有保护规则，还需允许 Actions bot 直接推送。

PDF/OCR 产生 `needs-review` 或字段冲突时，不发布。按 `data/reports/README.md` 审阅异常，并仅在 `data/一分一段/人工修正.json` 中添加有官方依据的确认修正，然后重新执行 `--check`。成功发布后，生成物按版本不可变；若需回滚，使用版本控制回退该年度发布提交（包括 metadata 和新增数据），不要手工覆盖旧 catalog 或 shard。
