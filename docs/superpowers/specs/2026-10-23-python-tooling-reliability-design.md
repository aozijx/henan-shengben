# Python 数据工具可靠性重构设计

## 目标

修复一分一段批量转换入口的运行时错误，并让下载器与发现器一样从 `data/source-registry.json` 驱动目标选择，保证新增年份只改注册表和数据文件。

## 范围与约束

- 不改变 PDF OCR、分数段解析、归一化规则，也不重写现有业务数据。
- `convert/convert_all.py` 继续按注册表的 `crawlTargets` 读取清单、人工修正与输出路径。
- `crawler/download.py` 改为通过共享 `load_crawl_targets()` 解析注册表；年份筛选语义与 `crawler/discover.py` 对齐。
- 下载失败不得覆盖现有 PDF；未知或未声明年份必须没有副作用。
- 保留命令行兼容性：无参数时仍处理全部注册目标，并提供 `--registry`、`--years` 与 `--data-root`。
- 测试使用临时目录和受控 session，不访问网络；每个修复先写失败测试。

## 方案选择

考虑过直接把 `convert_all.py` 的拼写改正、保留下载器目录扫描的最小修补方案；这会修复当前 `NameError`，但新增年份仍有两个不一致的配置入口。选择按注册表统一下载目标：这是既有 metadata/data-source 架构的一部分，改动局限在工具边界，不会波及 PDF 解析。

## 设计

`convert_all.py` 只使用 `convert.common` 导出的 `read_json()` 和 `write_json()`。其批量函数接收注册表声明的 target，空清单也应写出结构完整、汇总正确的输出文档。

`crawler/download.py` 新增一个可测试的 `download_targets(registry_path, data_root, years, session)` 编排函数：通过 `load_crawl_targets()` 得到排序后的 target，逐个读取其 `manifest_path`，再复用既有 `download_manifest()`。CLI 将参数传入该函数，不再对目录名称或文件名模式作假设。

## 验收

1. 空清单调用 `convert_target()` 不抛出 `NameError`，且写出正确汇总。
2. 下载器仅访问 registry 选中的 manifest；传入年份只处理该年。
3. 不在 registry 中的 JSON 清单不会被下载器扫描或改写。
4. `convert`、`crawler` 和完整 `npm test` 回归通过。
