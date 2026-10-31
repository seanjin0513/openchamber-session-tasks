# 会话任务

OpenChamber 2.5.3+ 的当前会话任务面板，配套 OpenCode V2 上报工具。

跟随当前会话切换；显示任务完成比例、待办、进行中、阻塞、取消和更新时间；支持全部、未完成和已完成筛选。Agent 空闲不等于任务完成。

## 安装

1. 在此目录执行 `npm ci && npm run build`（发布包已包含构建产物，可跳过）。
2. OpenChamber 扩展设置中添加本目录，启用扩展并允许本地服务。
3. 在此目录执行 `node scripts/companion.mjs install`，安装 OpenCode 上报组件。
4. 在 OpenChamber 扩展面板中打开「会话任务」。多步骤任务开始后，Agent 会收到上报提示。

安装脚本仅写入 `$XDG_CONFIG_HOME/opencode/plugins/openchamber-session-tasks`，未设置 XDG 时使用 `~/.config/opencode/plugins/openchamber-session-tasks`。不修改现有配置、AGENTS.md 或其他插件。OpenCode V2 自动监测插件；已在执行的模型请求可能到下一步才看到新工具。

## 数据与权限

- 仅保存 Agent 通过 `session_tasks_report` 主动上报的完整清单，不读取聊天记录，不猜测任务。
- 工具从执行上下文获取会话 ID，不能指定其他会话。`session_tasks_read` 返回当前清单和 revision；report 必须带上该 revision，冲突时重新读取。
- 每个会话最多 80 项任务，文件最大 60 KiB。取消的任务不计入完成比例。
- 数据固定存放在 `~/.local/share/openchamber-session-tasks/<sessionId>.json`，目录 0700、新文件 0600；不上网，不建数据库。
- 扩展服务仅监听 127.0.0.1，所有请求需宿主注入的令牌，面板通过宿主代理访问。服务只读，但宿主服务仍以当前用户权限运行。
- 本机面板不能读取远程 OpenCode 主机上的文件；本版仅支持面板和 OpenCode 运行在同一台机器。
- Agent 是否及时调用工具受模型行为影响；未上报就显示未上报，不承诺自动推断或每步更新。

## 卸载

先停止相关会话上报，执行 `node scripts/companion.mjs remove`，再在 OpenChamber 设置中移除此扩展。脚本只删除自身两个已识别文件，任务数据保留。需要清空任务数据时，在文件管理器中删除上述专用数据目录。

若 OpenCode 在写入时进程崩溃，可能留下 `<sessionId>.lock`。确认相关 OpenCode 进程已停止后仅删除这个锁文件，再重试；正常结束不会留下锁。

## 开发与验证

`npm run typecheck`、`npm test`（自动先构建）。7 项测试覆盖 manifest、隔离安装/卸载、模拟工具执行与真实 HTTP 服务、版本冲突、会话隔离、损坏文件和并发写入。测试使用临时目录，不更改真实 OpenCode 配置。

`npm run preview` 提供独立演示页，默认 http://127.0.0.1:4187，可用 `PORT` 指定端口。演示数据不写入真实任务目录，不包含在扩展入口中。已人工检查浅色桌面、深色 360px 窄屏、筛选、长文本、空会话、服务异常、断线和快速会话切换。真实 OpenChamber 安装及模型是否主动调用工具仍需启用后联调。
