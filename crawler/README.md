# 官方一分一段采集

采集器读取 `data/year-links/YYYY.json` 中的年份和官方来源链接。`discover.py` 从官方公告页生成一分一段 PDF 清单；`download.py` 读取这份清单并下载 PDF。只有 seed 在 `sources` 中声明了 `scoreSegments`，才会处理该年度；未声明就直接跳过，不要求提前填写一分一段来源。已声明但未填写 `pageUrl` 时，才会从搜索页寻找唯一公告；下载时若清单尚不存在，也会跳过该年。清单和 PDF 路径由年份自动派生，下一步直接使用上一步的输出，无需手填每个专业的文件名。依赖见 `crawler/requirements.txt`。

## 参数

| 入口 | 参数 | 作用 |
| --- | --- | --- |
| `discover.py`、`download.py` | `--seed PATH` | 指定一个年度链接文件，可重复传入；省略时读取 `--data-root/year-links/` 下所有年度文件。 |
| `discover.py`、`download.py` | `--years YYYY …` | 只处理指定年份；省略时处理所选链接文件中的全部年份。 |
| `discover.py`、`download.py` | `--data-root DIR` | 数据根目录，默认 `data`。 |
| `download.py` | `--compact-url-fields` | 只清理清单中与原 PDF 地址等价的 `finalUrl`，不联网或重新下载。 |
| `download.py` | `--major CODE` | 只下载或重试所选专业的 PDF；可重复传入，与 `--years` 配合缩小范围。 |

发现阶段将专业代号、名称、官方 PDF 地址和目标路径写入 `来源清单/来源清单_YYYY.json`。下载阶段读取该清单；文件 SHA-256 与记录一致时跳过下载，失败响应不会覆盖已有 PDF。下载后会校验实际地址仍在官方域名白名单内，也会拒绝非 PDF 内容。公告页允许使用 `haeea.cn`、`news.haeea.cn`、`heao.com.cn`、河南省教育厅域名 `jyt.henan.gov.cn` 和河南省教育厅高考信息网 `gaokao.haedu.cn`；PDF 附件允许使用这些官方域名及已验证的政府附件域名 `xcoss.henan.gov.cn`。

年度导入还会校验 PDF 是否能确认年份和来源类型。扫描版 PDF 没有正文文本时，也会检查可解码的标题元数据；正文和元数据都无法确认时仍会停止导入。

`pdfUrl` 是公告页给出的地址。只有服务器真正跳转到另一地址时才记录 `finalUrl`；单纯的中文 URL 百分号编码差异不算跳转。清理旧清单的重复字段时，`--compact-url-fields` 只删除这种等价地址，保留真实跳转、哈希和其他来源信息。

## 公告页访问受限

官方公告页可能返回 400/403/412。只有遇到这些状态且 `WAF_AUTO_BOOTSTRAP` 开启时，才会启动浏览器；普通成功请求不会打开浏览器。DrissionPage 会驱动 Chromium 内核浏览器。本机 Windows 默认优先使用已安装的 Microsoft Edge；找不到 Edge 时才使用 DrissionPage 自行选择的 Chromium（可能是 Chrome）。也可以用 `WAF_BROWSER_PATH` 明确指定浏览器程序路径。GitHub Actions 在 Ubuntu 24.04 上把此变量设为 `/usr/bin/microsoft-edge`，并通过 Xvfb 虚拟显示器以有头模式运行；Linux 启动会加入 `--no-sandbox`。共享 WAF 会话会串行处理 HTTP 请求和挑战重试；`pipeline_config.py` 中的 `DOWNLOAD_WORKERS` 默认是 1，避免多个下载线程同时争用 Cookie 状态。

本机 PowerShell 可显式指定 Edge 并运行单年导入：

```powershell
$env:WAF_BROWSER_PATH = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:WAF_HEADLESS = 'false'
python -m convert.ingest_year --seed data/year-links/2027.json --check
```

如果 Edge 安装在 64 位程序目录，把路径改为 `C:\Program Files\Microsoft\Edge\Application\msedge.exe`。交互模式下挑战期间保持浏览器窗口打开。自动引导要求浏览器页面长度超过 128 字符且不再含 `$_ts` 挑战标记；捕获到的 Cookie 先用于原请求重试，只有重试不再返回 400/403/412 才会保存到 `.waf-cookie`。日志中的“HTTP 重试通过，Cookie 已保存”表示请求已接受，日志不会输出 Cookie 或 User-Agent 值。程序启动的是独立浏览器会话，不能直接沿用已打开 Edge 窗口中的登录态或 Cookie。如果重试仍返回 400/412，可从已能访问的 Edge 手动复制匹配的 Cookie 和 User-Agent，见下文。检查 `[WAF] 浏览器：...` 日志可确认实际启动的程序。可在 `pipeline_config.py` 中将 `WAF_AUTO_BOOTSTRAP` 设为 `False` 关闭自动引导。

需要手动提供会话时，先在浏览器确认官方公告页可正常打开，再从该请求复制完整的 Cookie 请求头到 `.waf-cookie`。建议保存 JSON 对象，包含 `userAgent` 和 `cookie` 两个字段，以保持 Cookie 与浏览器标识一致。该文件已被 Git 忽略。会话失效后重新获取即可。

## 新年度来源

`data/year-links/YYYY.json` 是年度官方链接的配置入口。每种来源可填写公告页 `pageUrl`；当页面包含多个附件时，用 `attachmentUrl` 精确指定官方 PDF。需要在同一年度保留不同版本的官方附件时，可用 `localPath` 指定单独的相对 PDF 路径；路径不得越出 `data/`。`searchPageUrl` 只用于发现唯一的候选公告页。seed 中未声明的来源会跳过，不阻止已提供来源的验证与归档；只有来源齐全时才生成年度解析数据并更新 catalog。已声明的来源若候选不唯一、网页不可访问，或网页年份及类型不匹配，仍会停止导入。

2026 年的 `mappingOverview` 与 `mappingCodeTable` 是两份不同的官方表：前者按专科专业列出可报考的本科专业及考试科目，后者按招生专业列出专业代号和考试科目，均需保留。

2026 `mappingOverview` 的 Attachment 2 下载为 `专业对照/原始PDF/专业对照一览_附件2_2026.pdf`。仓库已有 Attachment 3 保留在 `专业对照/原始PDF/专业对照一览_2026.pdf`；两者字节不同，但本地解析出的 558 条对照数据相同，因此新附件使用单独路径，不覆盖现有文件。

新年度导入由 `convert.ingest_year` 负责：`--seed` 指向年度链接文件，`--check` 在暂存目录验证而不发布。默认输出简短摘要；需要来源和逐专业细节时加 `--full-report`。GitHub Actions 会按 PR 中变更的 seed 执行验证，把新增原始来源和来源清单上传为 artifact；PR 合并后，可信发布任务校验 artifact 的 PR、seed 哈希和文件哈希，再将源文件提交到 `main`。来源不完整时只归档原始来源，不刷新年度 catalog；来源齐全时在合并后由发布任务生成数据和 metadata。详细参数与审核规则见 [转换与导入指南](../convert/README.md)。
