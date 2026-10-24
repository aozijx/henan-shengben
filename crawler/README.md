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

## 官方站 WAF（瑞数动态安全）

公告页（`.shtml` 与 GovSearch）可能返回 403/412 挑战页，PDF 附件域（`/attach/file/`）不受影响，因此 `download.py` 通常无需处理。公告页有两种通过方式：

**自动引导（默认开启）**：首次遇到 403/412 时，会话自动调用 DrissionPage 拉起一个真实 Chromium（本机需装 Chrome 或 Edge）访问目标页，挑战通过后把 Cookie 与 UA 写回仓库根 `.waf-cookie` 并原地重试。需要 `pip install -r crawler/requirements.txt`；弹出的浏览器窗口在挑战期间不要关闭。`pipeline_config.py` 的 `WAF_AUTO_BOOTSTRAP = False` 可关闭。

**手动借用**：在浏览器打开任一公告页（确认非 412），开发者工具复制该请求 `Cookie` 请求头的完整值，保存到仓库根 `.waf-cookie`（已 gitignore，不会提交）。瑞数校验 Cookie 与 UA 的绑定关系，因此推荐存 JSON 格式 `{"userAgent": "浏览器UA", "cookie": "Cookie值"}`——会话会自动跟随文件内的 UA；存纯 Cookie 字符串则会话保持默认 UA，可能被 WAF 拒绝。

Cookie 失效（再次 412）后重复对应步骤即可。
# New-year source intake

Use `data/year-links/YYYY.json` as the human-maintained entry point. Each source role may provide an official `pageUrl` and, when page discovery is ambiguous, an exact official `attachmentUrl`. `searchPageUrl` is only used to discover a unique candidate. The ingest command rejects missing or ambiguous sources and validates page year/type before using attachments.

The official site may return an anti-bot response such as 403/412. In that case the command stops; add a precise official page or attachment URL to the seed and retry. Do not substitute a mirror URL. Download manifests retain source page, source URL, final URL, byte count and SHA-256. Failed responses never replace an existing file.

Run `python -m convert.ingest_year --seed data/year-links/YYYY.json --check` to validate and preview a year without publishing metadata. A successful `--check` can be published by rerunning without `--check` after reviewing the report. GitHub Actions performs the same check and uploads its report; it does not commit or merge generated data.
