# 官方数据转换

转换层只读取 `data/year-links/YYYY.json` 的年度身份与官方来源链接。清单、PDF、提取、规范数据和报告路径由共享构造器按年份派生，不在多个 CLI 或 JSON 文件中重复维护。

一分一段 PDF 没有文本层，是整页扫描图。流水线先由 `pdfplumber` 读取页码和内嵌图片，再由 RapidOCR 识别表格数字，最后通过纯解析器检查分数唯一性及累计人数单调性。快速识别违反约束时会自动逐单元格重试；仍无法确认的数字写入 `issues`，不会被静默补造。OCR 并发默认读取根目录 `pipeline_config.py`，CLI `--workers` 可临时覆盖。多进程按完成顺序显示进度，但年度索引仍按来源清单顺序保存。流式消费有利于及时显示结果和减少待处理对象，OCR 耗时仍主要由图像识别决定。

依赖见 `convert/requirements.txt`。所有命令从仓库根目录用 `python -m convert.<模块>` 调用；`--help` 可查看当前参数。各入口的主要参数如下：

| 模块 | 参数 | 用途 |
| --- | --- | --- |
| `convert_all` | `--year YYYY`（可重复） | 限定转换年度；省略时处理所有 seed 年度。 |
| `convert_all` | `--major CODE`（可重复） | 只转换指定专业，保留同年其他分片。代号必须在来源清单中。 |
| `convert_all` | `--retry-review` | 只重试现有索引中 `needs-review` 的专业；不可与 `--major` 同用。 |
| `convert_all` | `--verbose` | 默认只打印待审专业和年度汇总；加此项显示每个专业的完成状态。 |
| `convert_all` | `--workers N` | 覆盖 `pipeline_config.py` 的 OCR 进程数。 |
| `convert_all` | `--dataset NAME`、`--data-root PATH` | 指定数据集（当前为 `score-segments`）和数据根目录。 |
| `issue_reports` | `--years YYYY …`、`--full-report` | 限定年份；默认只保留可疑 OCR 行及上下文，完整 OCR 行仅在完整报告中写入。 |
| `normalize` | `--years YYYY …`、`--full-report` | 限定年份；默认转换报告省略成功专业的逐条权威解析。 |
| `segment_store` | `--year YYYY --output NEW_PATH` | 核对规范索引和分片哈希后导出合并副本；拒绝覆盖已有路径。 |
| `ingest_year` | `--seed YEAR_LINKS --check` | 在暂存目录核验新年度，不发布。去掉 `--check` 才发布。 |
| `ingest_year` | `--full-report` | 默认输出导入摘要和异常；加此项显示来源溯源与逐专业明细。 |
| `crawler.download` | `--major CODE`（可重复） | 只下载或重试指定专业的官方 PDF，可与年份筛选一起使用。 |
| 各入口 | `--data-root PATH` | 改用指定数据根目录，适合隔离演练。 |

一分一段只有一套持久化分片：年度索引 `一分一段/一分一段_<年份>.json` 和专业文件 `一分一段/<年份>/<专业代号>.json`。OCR 直接写这套分片；`normalize` 在同一文件补齐规范字段，确认修正也直接覆盖对应专业文件。每次写入先写临时文件再原子替换，索引保存分片 SHA-256。`needs-review` 保留在同一分片和索引中，但不会进入浏览器展示。单专业 `--major` 只重算该专业，`--retry-review` 只重算索引里待审的专业；两者不能同时使用。日志含完成数、专业代号和名称、错误码及原因。

合并命令仅用于临时导出，不参与处理链；日常转换、复核、重试和 catalog 都使用同一套规范分片。

批量转换、归一化和异常报告均枚举 `data/year-links/*.json`，再使用同一个年度派生视图；年份参数只筛选 seed，不扫描未声明年份。转换空清单也会生成完整的零计数结果，便于自动化流程稳定处理。

异常报告写入 `data/reports/异常数据_<年份>.json`，默认保留错误、可疑 OCR 行及上下文；只有 `issue_reports --full-report` 才附带每个待审专业的完整 OCR 行。人工核对规则见 `data/reports/README.md`。`data/一分一段/人工修正.json` 只初始化一次，不会被报告生成器覆盖。确认修正后重新运行 `python -m convert.issue_reports`：它只复核待审专业，将 `status: confirmed` 的修正直接应用并覆盖对应规范分片；`official-empty` 不作为待审异常，也不会生成分数段。这样无需重跑全量 OCR 或再次运行 `normalize`。

## 已有年度复核

`ingest_year` 仅用于新增年度，`--seed` 必须是单个 `data/year-links/YYYY.json` 文件；它会拒绝覆盖已有年度。复核 2024–2026 等已发布年份时，不要运行 `convert_all` 或 `ingest_year`。可在仓库根目录用 PowerShell 将 `data/` 和 metadata 复制到临时目录，再依次复核异常、归一化并刷新 catalog：

```powershell
$verifyData = Join-Path $env:TEMP ("henan-shengben-verify-" + [guid]::NewGuid().ToString("N"))
Copy-Item data $verifyData -Recurse
New-Item -ItemType Directory -Path "$verifyData/metadata" -Force | Out-Null
Copy-Item metadata/school-data.json "$verifyData/metadata/school-data.json"
$years = @(2024, 2025, 2026)

python -m convert.issue_reports --years $years --data-root $verifyData
if ($LASTEXITCODE -ne 0) { throw "issue_reports 失败，停止复核" }
python -m convert.normalize --years $years --data-root $verifyData
if ($LASTEXITCODE -ne 0) { throw "normalize 有阻塞项，未刷新 catalog" }
python -m convert.refresh_catalog --data-root $verifyData --template metadata/school-data.template.json --metadata "$verifyData/metadata/school-data.json"
```

`issue_reports` 没有 `--only-issues` 参数；它本身只会对索引中非 `ok` 的分片重新 OCR，并为选定年份写异常报告。`normalize` 会更新临时副本中的规范索引、专业分片和转换报告；存在阻塞项时退出码非零，脚本会停止。`refresh_catalog` 只更新临时副本中的派生文件和 metadata。将 `$years` 改为需要检查的年份；每次执行会新建隔离目录，不会改动仓库正式数据。

转换报告写入 `reports/转换报告_<年份>.json`。默认只保留 catalog 校验所需的计数、阻塞项、异常解析、官方空表和来源未列出记录；只有 `normalize --full-report` 才附带成功专业的逐条解析。归一化只发布 `status: ok` 且通过哈希、唯一性、严格降序和累计人数单调校验的专业。官方分数段清单未列出的代号会写入 `sourceUnavailable` 并附官方清单地址，不生成虚假分数段；catalog 只接受此类代号与省控线未覆盖清单完全一致。官方 PDF 明确为空表的情况仍通过人工文件的 `official-empty` 状态记录。

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
    "mappingOverview": {"pageUrl": "https://www.haeea.cn/..."},
    "master": {"pageUrl": "https://www.haeea.cn/...", "attachmentUrl": "https://xcoss.henan.gov.cn/...pdf"}
  }
}
```

`ingest_year` 的 `--seed` 指向新年度链接配置；首次运行附加 `--check`，默认摘要包含来源数量、转换计数、阻塞项和 metadata diff。加 `--full-report` 可输出所有来源 URL、实际跳转 URL（如有）、哈希和逐专业解析。检查模式只在临时目录生成结果，不写入 `data/` 或 metadata。人工确认后，去掉 `--check` 发布；已有年份会被拒绝，不能用此入口重跑覆盖。若发现官方网页返回 403/412、来源不唯一或缺附件，导入会失败且保留当前 metadata；先补齐或修正官方链接配置，再重试。当前入口要求官方公告页可读取；直接本地 PDF 离线导入尚未支持。

PDF/OCR 产生 `needs-review` 或字段冲突时，不发布。按 `data/reports/README.md` 审阅异常，并仅在 `data/一分一段/人工修正.json` 中添加有官方依据的确认修正，然后重新执行 `--check`。成功发布后，生成物按版本不可变；若需回滚，使用版本控制回退该年度发布提交（包括 metadata 和新增数据），不要手工覆盖旧 catalog 或 shard。
