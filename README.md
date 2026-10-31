# 会话任务

OpenChamber 2.5.3+ 的当前会话任务面板，配套 OpenCode V2 上报工具。

跟随当前会话切换；显示任务完成比例、待办、进行中、阻塞、取消和更新时间；支持全部、未完成和已完成筛选。Agent 空闲不等于任务完成。

支持在聊天的「工作状态」面板内显示「会话任务」分区，也保留独立扩展面板。工作状态分区默认展开；若没看到，可在工作状态的分区选择器中开启。内容高度自动调整，超过 320px 时在分区内滚动，安装组件的按钮也可在此使用。

## 安装

1. 在 OpenChamber「设置 → 扩展 → 添加扩展」中粘贴 `https://github.com/seanjin0513/openchamber-session-tasks`，启用并授权本地服务。也可添加本目录或 ZIP。
2. 打开「会话任务」面板，点击「安装上报组件」。
3. 检查面板显示的安装路径，点击「确认安装」。成功后显示「上报组件已安装」，全程无需终端。
4. 多步骤任务开始后，Agent 会收到上报提示。OpenCode V2 自动监测插件；工具未出现时可执行 `/reload` 强制重载 OpenCode 配置。

更新扩展后若组件内容不同，面板会显示「更新上报组件」，同样需要确认后才替换。打开面板、查询状态或添加扩展本身都不会自动安装组件；本地服务未授权时先授权，再点击面板刷新。安装目录存在未知文件或符号链接时停止安装，不覆盖它们。失败时面板会保留确认区，修复权限或目录冲突后可重试。

开发源码可执行 `npm ci && npm run build`；GitHub 仓库和发布包已包含构建产物。终端备用方式仍为 `node scripts/companion.mjs install`，状态检测为 `node scripts/companion.mjs status`。

安装器仅写入 `$XDG_CONFIG_HOME/opencode/plugins/openchamber-session-tasks`，未设置 XDG 时使用 `~/.config/opencode/plugins/openchamber-session-tasks`；安装过程中会在其 `opencode` 父目录创建临时目录和互斥锁，正常完成后清理。宿主本地服务通常不传入 XDG 环境变量，面板会显示它实际使用的默认路径。使用自定义 XDG 配置目录时请用同一环境下的终端备用安装命令。不修改现有配置、AGENTS.md 或其他插件。已在执行的模型请求可能到下一步才看到新工具。SDK 的 `connection.connected` 表示扩展第三方集成账号的连接状态，不是 OpenCode 或本地服务的连接状态；本扩展无需该集成，不使用它阻止任务读取。

## 数据与权限

- 仅保存 Agent 通过 `session_tasks_report` 主动上报的完整清单，不读取聊天记录，不猜测任务。
- 工具从执行上下文获取会话 ID，不能指定其他会话。`session_tasks_read` 返回当前清单和 revision；report 必须带上该 revision，冲突时重新读取。
- 每个会话最多 80 项任务，文件最大 60 KiB。取消的任务不计入完成比例。
- 数据固定存放在 `~/.local/share/openchamber-session-tasks/<sessionId>.json`，目录 0700、新文件 0600；不上网，不建数据库。
- 扩展服务仅监听 127.0.0.1，所有请求需宿主注入的令牌，面板通过宿主代理访问。任务接口只读；安装接口仅接受已确认的固定目标目录，不接受任意文件路径。宿主服务仍以当前用户权限运行。
- 本机面板不能读取远程 OpenCode 主机上的文件；本版仅支持面板和 OpenCode 运行在同一台机器。
- Agent 是否及时调用工具受模型行为影响；未上报就显示未上报，不承诺自动推断或每步更新。

## 卸载

先停止相关会话上报，执行 `node scripts/companion.mjs remove`，再在 OpenChamber 设置中移除此扩展。脚本只删除自身两个已识别文件，任务数据保留。需要清空任务数据时，在文件管理器中删除上述专用数据目录。

仅禁用或移除 OpenChamber 扩展不会自动移除已安装的 OpenCode 上报插件。

若 OpenCode 在写入时进程崩溃，可能留下 `<sessionId>.lock`。确认相关 OpenCode 进程已停止后仅删除这个锁文件，再重试；正常结束不会留下锁。

安装进程异常退出也可能留下 `~/.config/opencode/.session-tasks-install.lock` 及 `.session-tasks-install-*` 暂存目录。确认安装服务已经停止后再清理锁；如果暂存目录包含 `previous`，先保留并检查它，里面是替换前的组件。

## 开发与验证

`npm run typecheck`、`npm test`（自动先构建）。测试覆盖 manifest、隔离安装/卸载、模拟工具执行与真实 HTTP 服务、版本冲突、会话隔离、损坏文件、并发写入、安装确认、状态检测、更新与冲突保护，以及无集成账号时面板仍读取本地服务的回归场景。测试使用临时目录，不更改真实 OpenCode 配置。

`npm run preview` 提供独立演示页，默认 http://127.0.0.1:4187，可用 `PORT` 指定端口。演示数据不写入真实任务目录，不包含在扩展入口中。已人工检查浅色桌面、深色 360px 窄屏、筛选、长文本、空会话、服务异常、断线和快速会话切换。真实 OpenChamber 安装及模型是否主动调用工具仍需启用后联调。
