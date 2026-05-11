# CodexMobile

CodexMobile 是一个运行在自己电脑上的私有移动端 Codex 控制台。电脑仍然是真正的执行环境：文件、Git 仓库、Codex 会话、API 凭据和本地工具都留在电脑上；手机只通过浏览器连接到这台电脑，查看线程、发送消息、跟踪运行过程，并在需要时接收通知。

这个 fork 基于 [flyyangX/CodexMobile](https://github.com/flyyangX/CodexMobile)。当前分支主要面向 Windows + Codex Desktop + Tailscale 的使用方式，在原项目基础上补强了桌面端 IPC 同步、已有线程读取、Plan mode、用户输入卡片、Android HTTPS 推送和 Windows 弹窗问题。

Plan mode 和用户输入卡片部分也参考了 [bingqldx/CodexMobile](https://github.com/bingqldx/CodexMobile) 的实现思路，尤其是显式 Plan 入口和 app-server user-input request 的移动端卡片交互。本 fork 没有直接合并它的大型 `App.jsx` / `server/index.js` 重构，而是把相关能力迁入当前更模块化的结构。

## 这个 Fork 新增了什么

- **Windows Codex Desktop IPC 接入**：在 Desktop IPC 可用时，手机端可以向已有 Codex Desktop 线程发送和 steer 消息。
- **本地历史线程 fallback**：当 Codex app-server 的 `thread/list` 读不到历史线程时，自动从 `~/.codex/session_index.jsonl` 和 `~/.codex/sessions/**/*.jsonl` 重建线程列表。
- **隐藏 Windows 子进程窗口**：启动 Codex app-server 和 Git helper 时隐藏子进程窗口，避免手机连接或刷新时反复弹 `cmd` 窗口。
- **默认权限更保守**：手机 composer 默认使用普通/默认权限，而不是完全访问。
- **Plan mode 显式入口**：composer 里有 Chat/Plan 模式入口；`/plan` 和 `/计划` 会切换到 Plan mode，而不是作为普通文本发送。
- **用户输入卡片**：Codex app-server 发出的 `item/tool/requestUserInput` 可以在手机端显示为卡片，并从手机提交或取消。
- **Android HTTPS 推送**：Android Chrome 通过 Tailscale HTTPS 页面即可开启 Web Push，不强制要求安装为 PWA。
- **移动端状态同步修复**：WebSocket 会同步 user-input resolved 等状态，减少手机端卡片残留和线程状态不一致。

## 当前功能

### 桌面线程和会话同步

- 读取本机 `~/.codex/config.toml`、模型缓存、skills 和会话历史。
- 读取 Codex Desktop / Codex app-server 暴露的线程。
- app-server 读不到线程时，回退到本地 `.jsonl` rollout 文件。
- 在手机端查看项目、已有线程、普通对话、运行状态和最近活动。
- 支持打开、刷新、重命名、归档、隐藏会话。
- 支持向已有 Desktop-owned 线程发送 follow-up/steer。
- Desktop IPC 不可用时，可回退到后台 Codex runner。
- 发送前同步选中的模型和 reasoning effort。

### 手机端输入区

- 模型选择。
- reasoning effort 选择。
- 权限模式选择，默认是普通/默认权限。
- Chat / Plan 模式切换。
- 运行中线程支持 steer、queue、interrupt。
- `/status`、`/compact`、`/review`、`/subagents`、`/plan` 等 slash command。
- `$skill` mention。
- `@file` 项目文件搜索和引用。
- 图片和文件上传，内容保存在本机 `.codexmobile` 目录。

### Plan Mode 和用户输入

- Plan mode 会在新 turn 里发送 Codex collaboration mode 信息。
- `<proposed_plan>` 会渲染成计划卡片。
- 计划实现请求可以在手机端显示为可操作卡片。
- app-server user-input request 会显示成手机卡片。
- 用户输入卡片支持选项、自由输入、secret 输入、提交和取消。
- 卡片提交后通过 WebSocket 标记为已处理。

### Git 面板

- 查看 Git status、当前分支、dirty files、ahead/behind 和风险提示。
- 查看适合手机阅读的截断 diff。
- 支持 pull、push、sync、commit、commit+push。
- 支持查看本地分支、创建分支、切换分支。
- 支持生成可复制的 PR draft 文本。
- 当前不直接调用 GitHub 创建 PR。

### 通知

- 前台 toast：任务完成、失败、中止、Git 进度、需要用户输入。
- Web Push：任务完成、失败、中止、需要输入/处理时推送到手机。
- 推送订阅和 VAPID key 存储在 `.codexmobile/state/push-notifications.json`。
- Android Chrome 使用 Tailscale HTTPS 地址即可开启通知。
- 普通 HTTP 可以使用网页功能，但不适合作为后台推送来源。

### 可选本地工具

- OpenAI-compatible 图片生成，结果保存到本机。
- 可选语音识别、TTS、实时语音代理。
- 可选 CLIProxyAPI 配置/额度查询。
- 可选 `lark-cli` / 飞书文档集成。

## 重要限制

- 这不是公网 SaaS，也不是远程桌面。它是一个暴露在可信私有网络里的本机 Node.js bridge。
- 当前不能审批原生 Codex Desktop GUI 自己弹出的权限请求。也就是说，如果你直接在电脑上的 Codex Desktop 窗口里发起任务，运行到一半出现桌面端权限审批，手机端不承诺能看到或处理这个审批。
- 手机端用户输入卡片主要覆盖 CodexMobile 自己发起或 app-server 明确广播出来的 request。
- Desktop IPC 能力取决于当前 Codex Desktop 版本和线程是否有可用 owner。
- Web Push 必须走 HTTPS。`http://<tailscale-ip>:3321` 可以正常打开网页，但不能保证后台通知。

## 架构

```text
手机 / 平板 / 其他浏览器
  |
  | HTTP 或 HTTPS + WebSocket
  v
电脑上的 CodexMobile Node.js bridge
  |
  |-- pairing code + trusted device token
  |-- ~/.codex config / sessions / models / skills
  |-- Codex Desktop IPC handoff
  |-- Codex app-server / background runner fallback
  |-- Git service
  |-- upload / static file service
  |-- Web Push service
  |-- 可选语音、图片、飞书、CLIProxyAPI 集成
```

## 环境要求

- Node.js 20+
- npm
- 已配置好的本机 Codex 环境
- 如果要接入桌面线程，需要 Codex Desktop 正在运行
- 手机和电脑在同一个可信网络中，推荐 Tailscale
- 如果要 Android 后台通知，推荐开启 Tailscale Serve HTTPS
- 可选：Docker、本地 ASR、CLIProxyAPI、`lark-cli`、自定义证书

## 安装

```powershell
git clone https://github.com/SHXiao-Stella/CodexMobile.git
cd CodexMobile
git checkout windows-desktop-ipc-bridge
npm install
npm run build
```

启动服务：

```powershell
npm start
```

或者后台启动：

```powershell
npm run start:bg
```

关闭后台服务：

```powershell
npm run stop
```

Windows 上如果当前 PowerShell 找不到 `npm`，可以改用仓库里的包装脚本。这两个脚本不会修改 PowerShell profile、系统 `PATH`、注册表或 Tailscale 设置；它们只会在运行时定位 `node.exe`，然后调用项目自己的服务脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-codexmobile.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\stop-codexmobile.ps1
```

`start:bg` 和 `start-codexmobile.ps1` 会把进程标记为 `codexmobile`，并写入 `.codexmobile/server.pid`。停止脚本会校验服务名、当前项目路径、服务入口、端口和 PID 信息，因此不是简单地杀掉所有占用 `3321` 的进程。

电脑本机打开：

```text
http://127.0.0.1:3321
```

手机通过 Tailscale HTTP 打开：

```text
http://<电脑的 Tailscale IP>:3321
```

首次访问需要输入服务启动时打印的 6 位配对码。如果使用后台启动，可以查看：

```powershell
Get-Content .codexmobile\server.out.log -Tail 40
```

## Tailscale HTTPS 和 Android 推送

Android 消息推送推荐使用 Tailscale Serve HTTPS：

```powershell
tailscale serve --bg 3321
```

Windows 上如果 `tailscale` 不在 `PATH`：

```powershell
& 'C:\Program Files\Tailscale\tailscale.exe' serve --bg 3321
```

Tailscale 会输出类似这样的地址：

```text
https://<computer-name>.<tailnet>.ts.net/
```

在 Android Chrome 中打开这个 HTTPS 地址，完成配对后，点右上角菜单里的：

```text
开启完成通知
```

Chrome 弹出通知权限时选择允许。成功后应该会立刻收到一条测试通知。

查看当前 Tailscale Serve 状态：

```powershell
tailscale serve status
```

关闭 Tailscale Serve：

```powershell
tailscale serve --https=443 off
```

## 配置

可以直接用环境变量启动，也可以创建 `.env` 后运行：

```powershell
npm run start:env
```

常用配置：

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `HOST` | HTTP 监听地址 | `0.0.0.0` |
| `PORT` | HTTP 端口 | `3321` |
| `CODEX_HOME` | Codex 配置和会话目录 | `~/.codex` |
| `CODEXMOBILE_HOME` | CodexMobile 状态目录 | `.codexmobile/state` |
| `CODEXMOBILE_PUBLIC_URL` | 手机访问用的公开/私网地址 | 空 |
| `CODEXMOBILE_PAIRING_CODE` | 固定 6 位配对码 | 启动时随机生成 |
| `CODEXMOBILE_PUSH_SUBJECT` | Web Push VAPID subject | public URL，否则 `mailto:codexmobile@localhost` |
| `CODEXMOBILE_CODEX_BINARY` | Codex binary 路径覆盖 | `codex` |
| `CODEXMOBILE_DISABLE_HEADLESS_CODEX` | 禁用后台 Codex fallback | 未设置 |
| `CODEXMOBILE_INCLUDE_MISSING_SUBAGENT_THREADS` | 从 DB 补充缺失子线程 | 未设置 |
| `CLIPROXYAPI_CONFIG` | CLIProxyAPI 配置路径 | 未设置 |
| `CLIPROXYAPI_API_KEY` / `CLI_PROXY_API_KEY` | OpenAI-compatible API key | 未设置 |
| `CODEXMOBILE_FEISHU_APP_ID` / `CODEXMOBILE_FEISHU_APP_SECRET` | 飞书/Lark 集成凭据 | 未设置 |

不要提交 `.env`、`.codexmobile`、证书、日志、上传文件、生成图片、认证状态或本地 push subscription。

## 常用命令

开发服务端：

```powershell
npm run dev:server
```

Vite 前端开发服务：

```powershell
npm run dev:client
```

生产构建：

```powershell
npm run build
```

Smoke check：

```powershell
npm run smoke
```

当前分支常用测试：

```powershell
node --test client\src\composer\composer-options.test.mjs client\src\send-state.test.mjs client\src\turn-submission-utils.test.mjs client\src\session-live-refresh.test.mjs server\chat-request-prep.test.mjs server\chat-service.test.mjs server\codex-runner-status.test.mjs server\desktop-ipc-client.test.mjs server\git-service.test.mjs server\local-session-index.test.mjs server\session-index-builder.test.mjs server\session-message-reader.test.mjs server\codex-app-server.test.mjs client\src\web-push-client.test.mjs client\src\notification-events.test.mjs
```

## 本地数据位置

- 配对和可信设备：`.codexmobile/state/auth-state.json`
- Web Push VAPID key 和订阅：`.codexmobile/state/push-notifications.json`
- 上传、生成文件、预览和缓存：`.codexmobile/`
- Codex 会话和 rollout：`~/.codex/sessions`
- Codex 会话索引：`~/.codex/session_index.jsonl`
- Codex 配置和模型缓存：`~/.codex/config.toml`、`~/.codex/models_cache.json`

## 安全说明

- 只建议绑定到可信网络，例如 Tailscale 或局域网。
- API、WebSocket、上传、Git 和通知接口都通过 pairing token 保护。
- Tailscale Serve 默认只暴露给 tailnet；除非另外启用 Funnel，否则不是公网服务。
- Git 操作和 Codex 执行都发生在运行服务的电脑上。
- 启用文档、API、语音或图片集成前，应先确认本地配置和密钥范围。

## 当前分支

当前 fork 分支：

```text
windows-desktop-ipc-bridge
```

这个分支包含 Windows Desktop IPC handoff、Plan mode/user-input cards、本地 session fallback 和 Android HTTPS Web Push 支持。
