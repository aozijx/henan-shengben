# 异常数据人工核对

`异常数据_<年份>.json` 是每次运行 `python convert/issue_reports.py` 重新生成的核对报告。每条异常包含：

- `issueId`：稳定标识，格式为“年份-专业代号”；
- `officialControlScore`：同年官方省控线，便于判断表格末端；
- `sourcePdf`、`officialPdfUrl`、`sourcePageUrl`、`sourceSha256`、`sourceBytes`：源文件与溯源信息；
- `errors`：阻止发布的错误码及说明；
- `rawRows`：该专业所有 OCR 行，单行四列依次是“分数、累计人数、分数、累计人数”；
- `suspiciousRows`：程序定位的可疑行，附前一行和后一行 `contextRows`。

人工结果填写在 `data/一分一段/人工修正.json`。该文件只在不存在时初始化，重新生成异常报告不会覆盖人工内容。

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

再次运行 `convert/convert_all.py` 时只应用 `confirmed` 修正，并重新执行分数严格降序及累计人数单调校验。`pending` 记录始终不会参与正式数据。

如果官方 PDF 明确为空表且官方省控线也没有该专业，可将状态写为 `official-empty` 并在 `evidenceNote` 记录依据。归一化阶段会在转换报告中列出该专业，但不会生成虚假分数段。
