# 官方一分一段采集

爬虫从 `data/source-registry.json` 的 `crawlTargets` 读取年份、发现页、官方来源页、清单路径和下载目录。教育网镜像页仅用于发现链接；只有 `haeea.cn`、`news.haeea.cn`、`heao.com.cn` 官方域名的 PDF 会进入清单。

```powershell
pip install -r crawler/requirements.txt
python crawler/discover.py --years 2024 2025 2026
python crawler/download.py
python crawler/download.py --years 2026
python crawler/download.py --registry data/source-registry.json --data-root data
```

下载器和发现器都只读取 `data/source-registry.json` 的 `crawlTargets`：`--years` 只处理所选年份，未在注册表声明的清单即使位于来源清单目录也不会被扫描。命令可以重复运行。SHA-256 一致的文件会跳过；失败响应和非 PDF 内容不会覆盖已有文件。
# New-year source intake

Use `data/year-links/YYYY.json` as the human-maintained entry point. Each source role may provide an official `pageUrl` and, when page discovery is ambiguous, an exact official `attachmentUrl`. `searchPageUrl` is only used to discover a unique candidate. The ingest command rejects missing or ambiguous sources and validates page year/type before using attachments.

The official site may return an anti-bot response such as 403/412. In that case the command stops; add a precise official page or attachment URL to the seed and retry. Do not substitute a mirror URL. Download manifests retain source page, source URL, final URL, byte count and SHA-256. Failed responses never replace an existing file.

Run `python -m convert.ingest_year --seed data/year-links/YYYY.json --check` to validate and preview a year without publishing metadata. A successful `--check` can be published by rerunning without `--check` after reviewing the report. GitHub Actions performs the same check and uploads its report; it does not commit or merge generated data.
