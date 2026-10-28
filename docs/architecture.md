# 系统架构

项目由浏览器查询应用和 Python 数据导入流水线组成。年度来源配置连接采集、转换和发布流程；浏览器运行所需的数据与字段规则由发布后的 metadata 提供。

## 浏览器应用

`index.html` 提供页面结构，`js/app.js` 组合应用并连接各视图控制器，`js/result-coordinator.js` 协调查询、汇总、详情和年份切换等异步工作。

| 层次 | 模块 | 职责 |
| --- | --- | --- |
| 数据访问 | `data-source.js`、`data.js`、`bootstrap.js` | 解析 metadata 路径、请求并缓存 JSON、加载年度数据、构建应用级查找索引。 |
| 状态与控制 | `query.js`、`explorer.js`、`explorer-state.js`、`result-coordinator.js`、`results-controller.js` | 将输入转为查询和筛选操作，协调异步结果并更新视图。浏览器状态由 `reduceExplorerState` 接受具名操作后转换，再发送一次状态变化通知。 |
| 领域逻辑 | `model.js`、`major-match.js`、`plan-filter.js`、`pipeline.js`、`aggregate.js`、`result-model.js`、`analytics-query.js`、`analytics-projection.js` | 规范化记录、匹配专业、筛选和汇总招生数据，并构造视图模型。 |
| 展示与导出 | `results-view.js`、`year-stack.js`、`stats-page.js`、`table-utils.js`、`export.js`、`export-dialog.js` | 渲染查询和统计视图，生成 CSV。 |
| metadata 与偏好 | `metadata.js`、`preferences.js`、`theme.js` | 校验和展开已发布 metadata、保存用户偏好、管理主题。 |

`bootstrapData(metadataUrl, fetchImpl)` 加载 metadata 并返回 `{ metadata, repository, data }`。`createDataRepository(metadata, fetchImpl)` 是 JSON 请求与缓存的统一边界；`createDataContext(repository)` 管理每个应用实例的年度映射和查找索引。`getScore`、`getColleges` 和 `getMasterRows` 显式接收年份，不依赖全局活动数据或查询监听器。

应用先加载初始查询对照表；查询结果随后加载所选年份的摘要数据，并由 `setSummaryStore` 建立筛选索引。院校和分数段详情在展开结果或请求分数曲线时按需加载。`result-coordinator.js` 通过请求标识丢弃过期结果。查询控件只绑定一次；专业筛选器从状态渲染并委托事件，避免重复绑定。

## 数据与配置归属

| 配置内容 | 唯一维护位置 | 用途 |
| --- | --- | --- |
| 年度官方链接和来源覆盖项 | `data/year-links/YYYY.json` | 人工维护的年度来源声明。 |
| 年度角色、路径和解析计划 | `crawler/year_sources.py` | 生成采集和转换共用的 `build_data_plan(...)`；可选目标由 seed 中声明的来源决定。 |
| 浏览器可用年份、文件路径和字段规则 | `metadata/school-data.json`、`metadata/school-data.template.json` | 供页面读取的发布 metadata 及其模板。 |
| 网络和 OCR 参数 | `pipeline_config.py` | 请求超时、WAF 引导、下载和设备默认值。 |
| Actions 触发条件和权限 | `.github/workflows/yearly-data.yml` | GitHub Actions 工作流策略和发布行为。 |

这些配置描述不同生命周期，保持各自唯一归属；不要在命令专属配置中重复维护年度来源角色或浏览器字段规则。

## Python 数据流水线

`crawler/` 校验官方 URL、发现附件、下载文件并管理串行 WAF 会话。`convert/` 提取、规范化、校验并发布规范 JSON 与浏览器 metadata。采集和转换通过 `crawler.year_sources.build_data_plan` 共用年度来源计划；本地 PDF 转换保留为独立离线入口。

GitHub Actions 校验年度 seed 派生的 artifact 并发布已验证的数据。工作流只维护触发和权限策略；数据角色和解析规则由共享年度计划维护。
