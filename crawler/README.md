# 官方一分一段采集

爬虫从 `data/source-registry.json` 的 `crawlTargets` 读取年份、发现页、官方来源页、清单路径和下载目录。教育网镜像页仅用于发现链接；只有 `haeea.cn`、`news.haeea.cn`、`heao.com.cn` 官方域名的 PDF 会进入清单。

```powershell
pip install -r crawler/requirements.txt
python crawler/discover.py --years 2024 2025 2026
python crawler/download.py
```

命令可以重复运行。SHA-256 一致的文件会跳过；失败响应和非 PDF 内容不会覆盖已有文件。
