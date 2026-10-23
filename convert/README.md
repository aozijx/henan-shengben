# 官方数据转换

转换层只读取 `data/source-registry.json` 与其中声明的年度来源清单，不在 Python 中维护文件名表。

一分一段 PDF 没有文本层，是整页扫描图。流水线先由 `pdfplumber` 读取页码和内嵌图片，再由 RapidOCR 识别表格数字，最后通过纯解析器检查分数唯一性及累计人数单调性。快速识别违反约束时会自动逐单元格重试；仍无法确认的数字写入 `issues`，不会被静默补造。全量模式默认使用 4 个工作进程，并限制每个 OCR 引擎的线程数，避免 CPU 过度争用。

```powershell
python -m pip install -r convert/requirements.txt
python convert/convert_all.py --dataset score-segments --year 2026
python convert/convert_all.py --dataset score-segments --year 2026 --major 01
python convert/issue_reports.py
python convert/normalize.py --years 2024 2025 2026
python -m unittest discover -s convert/tests -v
```

年度中间结果路径由注册表的 `extractionPath` 指定。`status: needs-review` 的专业不能直接进入前端；下一阶段会结合官方专业对照、省控线和跨表约束完成权威归一化与冲突报告。

批量转换和归一化均从 `data/source-registry.json` 的 `crawlTargets` 读取年份、来源清单和输出路径；新增年份不在 Python 中增加文件名分支。转换空清单也会生成完整的零计数结果，便于自动化流程稳定处理。

异常报告写入 `data/reports/异常数据_<年份>.json`，人工核对规则见 `data/reports/README.md`。`data/一分一段/人工修正.json` 只初始化一次，不会被报告生成器覆盖；转换器仅应用其中 `status: confirmed` 的修正。

归一化结果写入注册表声明的 `normalizedPath`，转换报告写入 `conversionReportPath`。归一化只发布 `status: ok` 且通过哈希、唯一性、严格降序和累计人数单调校验的专业；官方空表通过人工文件的 `official-empty` 状态显式记录，但不伪造分数段。
# Automated yearly ingestion

After adding an official source seed at `data/year-links/YYYY.json`, run:

```powershell
python -m convert.ingest_year --seed data/year-links/YYYY.json --check
```

Review source provenance, row counts, score-segment coverage and the metadata diff. If all sources and OCR rows are confirmed, rerun without `--check` to publish the yearly canonical JSON, versioned analytics/index/shards and metadata. Existing years cannot be re-ingested by this command. Resolve OCR issues through the normal conversion review/correction process before publishing.
