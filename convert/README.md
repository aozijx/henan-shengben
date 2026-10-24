# 官方数据转换

转换层只读取 `data/year-links/YYYY.json` 的年度身份与官方来源链接。清单、PDF、提取、规范数据和报告路径由共享构造器按年份派生，不在多个 CLI 或 JSON 文件中重复维护。

一分一段 PDF 没有文本层，是整页扫描图。流水线先由 `pdfplumber` 读取页码和内嵌图片，再由 RapidOCR 识别表格数字，最后通过纯解析器检查分数唯一性及累计人数单调性。快速识别违反约束时会自动逐单元格重试；仍无法确认的数字写入 `issues`，不会被静默补造。全量模式默认使用 4 个工作进程，并限制每个 OCR 引擎的线程数，避免 CPU 过度争用。

```powershell
python -m pip install -r convert/requirements.txt
python convert/convert_all.py --dataset score-segments --year 2026
python convert/convert_all.py --dataset score-segments --year 2026 --major 01
python convert/issue_reports.py
python convert/normalize.py --years 2024 2025 2026
python -m unittest discover -s convert/tests -v
```

年度中间结果写入约定的 `一分一段/提取结果/提取结果_<年份>.json`。`status: needs-review` 的专业不能直接进入前端；下一阶段会结合官方专业对照、省控线和跨表约束完成权威归一化与冲突报告。

批量转换、归一化和异常报告均枚举 `data/year-links/*.json`，再使用同一个年度派生视图；`--years` 只筛选 seed，不扫描未声明年份。转换空清单也会生成完整的零计数结果，便于自动化流程稳定处理。旧 `--registry` 参数会明确报迁移错误，不会静默读取陈旧链接。

异常报告写入 `data/reports/异常数据_<年份>.json`，人工核对规则见 `data/reports/README.md`。`data/一分一段/人工修正.json` 只初始化一次，不会被报告生成器覆盖；转换器仅应用其中 `status: confirmed` 的修正。

归一化结果写入 `一分一段/一分一段_<年份>.json`，转换报告写入 `reports/转换报告_<年份>.json`。归一化只发布 `status: ok` 且通过哈希、唯一性、严格降序和累计人数单调校验的专业；官方空表通过人工文件的 `official-empty` 状态显式记录，但不伪造分数段。

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

先执行 `python -m convert.ingest_year --seed data/year-links/YYYY.json --check`，检查 JSON 报告中的来源 URL/最终 URL/哈希、转换行数、覆盖情况和 metadata diff。检查模式只在临时目录生成结果，不写入 `data/` 或 metadata。人工确认后，去掉 `--check` 发布；已有年份会被拒绝，不能用此命令重跑覆盖。若发现官方网页返回 403/412、来源不唯一或缺附件，导入会失败且保留当前 metadata；不要用学校转载链接绕过官方来源校验。可先补齐或修正官方链接种子，再重试。当前命令要求官方公告页可读取；直接本地 PDF 离线导入尚未支持。

PDF/OCR 产生 `needs-review` 或字段冲突时，不发布。按 `data/reports/README.md` 审阅异常，并仅在 `data/一分一段/人工修正.json` 中添加有官方依据的确认修正，然后重新执行 `--check`。成功发布后，生成物按版本不可变；若需回滚，使用版本控制回退该年度发布提交（包括 metadata 和新增数据），不要手工覆盖旧 catalog 或 shard。
# Automated yearly ingestion

After adding an official source seed at `data/year-links/YYYY.json`, run:

```powershell
python -m convert.ingest_year --seed data/year-links/YYYY.json --check
```

Review source provenance, row counts, score-segment coverage and the metadata diff. If all sources and OCR rows are confirmed, rerun without `--check` to publish the yearly canonical JSON, versioned analytics/index/shards and metadata. Existing years cannot be re-ingested by this command. Resolve OCR issues through the normal conversion review/correction process before publishing.
