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
