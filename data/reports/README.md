# 异常数据人工核对

`异常数据_<年份>.json` 由 `python -m convert.issue_reports` 在仍有待审异常时生成；没有异常时不生成，并删除旧的空报告。默认省略完整 OCR 行，只保留可疑行及其上下文；只有确需整页逐行查看时才加 `--full-report`。每条异常包含：

- `issueId`：稳定标识，格式为“年份-专业代号”；
- `officialControlScore`：同年官方省控线，便于判断表格末端；
- `sourcePdf`、`officialPdfUrl`、`sourcePageUrl`、`sourceSha256`、`sourceBytes`：源文件与溯源信息；
- `errors`：阻止发布的错误码及说明；
- `rawRows`：完整模式下该专业所有 OCR 行，单行四列依次是“分数、累计人数、分数、累计人数”；
- `suspiciousRows`：程序定位的可疑行，附前一行和后一行 `contextRows`。

人工结果填写在 `data/一分一段/人工修正.json`。该文件只在有待审异常且不存在时初始化，重新生成异常报告不会覆盖人工内容。重新运行 `python -m convert.issue_reports` 时，程序只复核当前待审专业；已确认为 `confirmed` 的修正会在校验通过后写回对应 OCR 分片，并刷新分片索引。无需重新抽取其他专业。

若专业代码存在于当年省控线，但官方一分一段附件清单没有该代码，年度转换摘要会在 `metadata/school-data.json` 的 `conversionReports` 中以 `sourceUnavailable` 列出它和官方清单地址。该状态代表官方清单没有对应 PDF，不等同于 OCR 失败，也不会创建虚构分数段；catalog 会逐项核对该清单与省控线的差集。

## 单元格修正

将对应记录的 `status` 改成 `confirmed`，在 `cellOverrides` 中按报告的页码、全局行号和列号填写修正：

```json
{
  "pageNumber": 2,
  "rowIndex": 42,
  "columnIndex": 2,
  "value": "80"
}
```

列号为 `0..3`。例如 `cells: ["107", "1232", "805", "2192"]` 中错误的 `805` 位于第 2 列。

## 整表替换

若 PDF 没有识别出任何行，可在 `replacementSegments` 填写完整的分数段数组：

```json
[
  { "score": 200, "cumulativeCount": 1 },
  { "score": 198, "cumulativeCount": 2 }
]
```

`confirmed` 修正会在异常报告阶段重新读取对应 PDF、应用单元格覆盖并重新校验分数顺序和累计人数；通过后将该专业更新为 `ok`。校验仍失败时保留待审状态并继续列入报告。`pending` 记录不会参与转换结果。

如果官方 PDF 明确为空表且官方省控线也没有该专业，可将状态写为 `official-empty` 并在 `evidenceNote` 记录依据。归一化阶段会在年度转换摘要中列出该专业，但不会生成虚假分数段。
