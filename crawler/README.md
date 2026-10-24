# 官方一分一段采集

爬虫从 `data/year-links/YYYY.json` 读取年度和官方来源链接，并按年份确定性派生来源清单、下载、提取、归一化与报告路径。PDF 下载只允许 HTTPS 的 `haeea.cn`、`news.haeea.cn`、`heao.com.cn` 和已验证的政府附件域名 `xcoss.henan.gov.cn`。

```powershell
pip install -r crawler/requirements.txt
python crawler/discover.py --years 2024 2025 2026
python crawler/download.py
python crawler/download.py --years 2026
python crawler/download.py --seed data/year-links/2026.json --data-root data
```

未传 `--seed` 时，发现器和下载器读取 `--data-root/year-links/*.json`；`--years` 只保留所选年份。命令可以重复运行。SHA-256 一致的文件会跳过；失败响应、HTTP 跳转出白名单和非 PDF 内容都不会覆盖已有文件。
# New-year source intake

Use `data/year-links/YYYY.json` as the human-maintained entry point. Each source role may provide an official `pageUrl` and, when page discovery is ambiguous, an exact official `attachmentUrl`. `searchPageUrl` is only used to discover a unique candidate. The ingest command rejects missing or ambiguous sources and validates page year/type before using attachments.

The official site may return an anti-bot response such as 403/412. In that case the command stops; add a precise official page or attachment URL to the seed and retry. Do not substitute a mirror URL. Download manifests retain source page, source URL, final URL, byte count and SHA-256. Failed responses never replace an existing file.

Run `python -m convert.ingest_year --seed data/year-links/YYYY.json --check` to validate and preview a year without publishing metadata. A successful `--check` can be published by rerunning without `--check` after reviewing the report. GitHub Actions performs the same check and uploads its report; it does not commit or merge generated data.
