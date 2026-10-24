# 年度来源配置单一事实源设计

## 意图

每年度的 `data/year-links/YYYY.json` 是来源 URL 和年度来源身份的唯一人工事实源。新增或回放年度时只维护这一份文件，避免 `source-registry.json`、CLI 默认参数、Action 和 README 各自保存一份来源链接。

## 方案与选择

保留双配置会继续产生链接漂移，不采用。删除所有共享登记能力会迫使解析、规范化和发布各自重建解析器与路径规则，也不采用。采用单一 seed + 派生执行视图：crawler、convert、校验、catalog 和 Action 直接消费年度 seed；文件路径、解析器职责、分数段采集目标由共用代码从 seed 与稳定的数据契约推导。`source-registry.json` 不再作为手工输入或运行时真相；若迁移期间保留兼容输出，必须由 seed 确定性生成、可验证且不可手工维护，最终移除重复的 `crawlTargets`。

## 范围与约束

- 建立 2024、2025、2026 年 seed；旧年度允许记录已知来源，但历史源页面/附件未验证时不得伪称已完成在线导入。
- 年份、来源角色和 URL 只从 seed 读取；搜索结果只补全唯一官方公告页，歧义/412/来源缺失必须失败关闭。
- 2024/2025 既有 mappingReference 行为与 canonical 数据不因本次配置迁移而改变；不得覆盖原始文件、人工修正或 metadata。
- 转换路径、parser、expected row count 等派生执行信息只有一个公共构造器，接受 seed 和本地文件清单；禁止每个消费者各自拼路径。
- GitHub Action 与本地命令调用同一 intake/check 流程。Actions 只产生审查报告，不自动发布/合并。

## 受影响边界

迁移 `crawler.discover/download`、`convert.convert_all/extract/normalize/issue_reports/refresh_catalog/ingest_year` 及其 CLI、测试、README、数据目录说明和 GitHub workflow。保留来源清单、PDF 哈希、转换报告和 catalog 作为审计产物；它们是处理记录，不是第二份来源配置。

## 验收

- 三个年度 seed 可校验；同一 seed 派生出一致的执行目标和路径。
- 全仓运行不需要读取 `data/source-registry.json`，旧重复 `crawlTargets` 配置被移除；所有本地 CLI、转换、catalog 和 Action 检查均使用公共 seed 接口。
- 错年、重复来源、歧义候选、非官方 URL、412、缺附件仍失败关闭；失败不改变 canonical 数据和 metadata。
- 2024–2026 既有 canonical、原始 PDF、来源 manifest、校正与 metadata 哈希不变；2026 临时全量回放和 2027 合成新增年端到端验收通过。
- Python、Node、workflow-contract 测试通过，文档只描述新的单一入口。
