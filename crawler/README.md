# 官方一分一段采集

采集器读取 `data/year-links/YYYY.json` 中的年份和官方来源链接。`discover.py` 从官方公告页生成一分一段 PDF 清单；`download.py` 读取这份清单并下载 PDF。清单和 PDF 路径由年份自动派生，下一步直接使用上一步的输出，无需手填每个专业的文件名。依赖见 `crawler/requirements.txt`。

## 参数

| 入口 | 参数 | 作用 |
| --- | --- | --- |
| `discover.py`、`download.py` | `--seed PATH` | 指定一个年度链接文件，可重复传入；省略时读取 `--data-root/year-links/` 下所有年度文件。 |
| `discover.py`、`download.py` | `--years YYYY …` | 只处理指定年份；省略时处理所选链接文件中的全部年份。 |
| `discover.py`、`download.py` | `--data-root DIR` | 数据根目录，默认 `data`。 |
| `download.py` | `--compact-url-fields` | 只清理清单中与原 PDF 地址等价的 `finalUrl`，不联网或重新下载。 |
| `download.py` | `--major CODE` | 只下载或重试所选专业的 PDF；可重复传入，与 `--years` 配合缩小范围。 |

发现阶段将专业代号、名称、官方 PDF 地址和目标路径写入 `来源清单/来源清单_YYYY.json`。下载阶段读取该清单；文件 SHA-256 与记录一致时跳过下载，失败响应不会覆盖已有 PDF。下载后会校验实际地址仍在官方域名白名单内，也会拒绝非 PDF 内容。公告页允许使用 `haeea.cn`、`news.haeea.cn`、`heao.com.cn` 和河南省教育厅高考信息网 `gaokao.haedu.cn`；PDF 附件允许使用这些官方域名及已验证的政府附件域名 `xcoss.henan.gov.cn`。

年度导入还会校验 PDF 是否能确认年份和来源类型。扫描版 PDF 没有正文文本时，也会检查可解码的标题元数据；正文和元数据都无法确认时仍会停止导入。

`pdfUrl` 是公告页给出的地址。只有服务器真正跳转到另一地址时才记录 `finalUrl`；单纯的中文 URL 百分号编码差异不算跳转。清理旧清单的重复字段时，`--compact-url-fields` 只删除这种等价地址，保留真实跳转、哈希和其他来源信息。

## 公告页访问受限

官方公告页可能返回 400/403/412。默认开启自动引导：会话遇到挑战时会使用 DrissionPage 启动本机 Chrome 或 Edge，通过后把 Cookie 和浏览器标识写入仓库根目录的 `.waf-cookie`，然后重试原请求。浏览器必须加载有效正文后才会保存 Cookie，避免把空白错误页误判为挑战通过。安装 `crawler/requirements.txt` 中的依赖；本机交互模式下挑战期间保持弹出的浏览器窗口打开。GitHub Actions 使用 Ubuntu 24.04 预装的 Microsoft Edge，通过 Xvfb 虚拟显示器以有头模式运行；Linux 启动会加入 Chromium 所需的 `--no-sandbox` 参数。是否能通过官方站的 WAF 挑战仍以实际工作流运行为准。可在 `pipeline_config.py` 中将 `WAF_AUTO_BOOTSTRAP` 设为 `False` 关闭自动引导。

需要手动提供会话时，先在浏览器确认官方公告页可正常打开，再从该请求复制完整的 Cookie 请求头到 `.waf-cookie`。建议保存 JSON 对象，包含 `userAgent` 和 `cookie` 两个字段，以保持 Cookie 与浏览器标识一致。该文件已被 Git 忽略。会话失效后重新获取即可。

## 新年度来源

`data/year-links/YYYY.json` 是年度官方链接的配置入口。每种来源可填写公告页 `pageUrl`；当页面包含多个附件时，用 `attachmentUrl` 精确指定官方 PDF。`searchPageUrl` 只用于发现唯一的候选公告页。来源缺失、候选不唯一、网页不可访问，或网页年份及类型不匹配时，采集会停止；应修正官方链接配置后重试，不使用转载镜像。

2026 年的 `mappingOverview` 与 `mappingCodeTable` 是两份不同的官方表：前者按专科专业列出可报考的本科专业及考试科目，后者按招生专业列出专业代号和考试科目，均需保留。

新年度完整导入由 `convert.ingest_year` 负责：`--seed` 指向年度链接文件，`--check` 在暂存目录验证而不发布。默认输出简短摘要；需要来源和逐专业细节时加 `--full-report`。GitHub Actions 会把仓库数据复制到临时工作区，在那里执行完整导入，并上传与仓库不同的生成文件和报告供审核；它不会提交或合并这些文件。详细参数与审核规则见 [转换与导入指南](../convert/README.md)。
