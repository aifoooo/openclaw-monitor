# OpenClaw Monitor

实时监控 OpenClaw 运行状态，追踪每次请求的操作细节。

## 背景

OpenClaw 服务器通常部署在云端，而用户在本地使用。当需要监控运行状态时，直接访问云端 Web UI 会面临：

- **网络延迟高**：服务器在香港，用户在大陆，加载资源慢
- **数据同步慢**：每次刷新都要重新拉取全量数据
- **调试困难**：看不到 LLM 的原始输入输出

本项目通过**本地缓存 + 增量同步**解决这些问题，同时通过**HTTP 代理**捕获完整的 LLM 请求响应。

## 功能特性

### 核心功能

| 功能 | 说明 |
|------|------|
| 📋 渠道管理 | 查看已配置的渠道列表，切换当前渠道 |
| 💬 聊天列表 | 查看当前渠道下的所有聊天 |
| 📝 消息详情 | 查看用户发送的消息和助手回复 |
| 🔍 操作追踪 | 追踪每次请求触发的所有操作（命令执行、LLM 调用、API 调用） |
| 📊 性能分析 | 显示每个操作的耗时、Token 使用量 |
| 🔄 实时更新 | 文件变更自动推送，无需手动刷新 |

### 特色功能

- **LLM 输入输出捕获**：通过 HTTP 代理拦截，记录完整的 prompt 和响应
- **流式响应支持**：正确处理 LLM 的流式输出
- **离线查看**：本地缓存历史数据，断网也能查看

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│  OpenClaw Gateway                                          │
│  baseUrl: http://localhost:38080/v3                        │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  监控代理 (packages/proxy)                                  │
│  - 拦截 LLM 请求/响应                                       │
│  - 记录到本地日志                                           │
│  - 转发到真实 API                                           │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  后端服务 (packages/backend)                                │
│  - 解析 session 文件                                        │
│  - 合并代理日志                                             │
│  - 提供 REST API + WebSocket                                │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  前端客户端 (packages/client)                               │
│  - Tauri + Vue 3                                            │
│  - 本地 SQLite 缓存                                         │
│  - 实时数据展示                                             │
└─────────────────────────────────────────────────────────────┘
```

## 数据流

```
1. OpenClaw 调用 LLM
   └── 请求发送到本地代理 (localhost:38080)
       └── 代理记录请求 body → 转发到真实 API
           └── 代理记录响应 body → 返回给 OpenClaw
               └── 后端读取代理日志

2. OpenClaw 写入 session 文件
   └── 后端监听文件变更
       └── 解析并推送更新到前端

3. 前端展示
   └── 渠道列表、聊天列表、消息详情、操作追踪
```

## 项目结构

```
openclaw-monitor/
├── packages/
│   ├── proxy/            # HTTP 代理
│   │   └── src/
│   │       └── index.ts  # 代理服务
│   ├── backend/          # 后端服务
│   │   └── src/
│   │       ├── parser/   # session 文件解析
│   │       ├── routes/   # REST API
│   │       └── watcher/  # 文件监听
│   └── client/           # 前端客户端
│       ├── src/          # Vue 3 前端
│       └── src-tauri/    # Tauri 后端
├── docs/
│   └── architecture.md   # 详细架构设计
├── package.json
└── pnpm-workspace.yaml
```

## 快速开始

### 前置要求

- Node.js >= 18
- pnpm >= 8
- Rust >= 1.70（用于 Tauri）

### 安装

```bash
git clone https://github.com/aifoooo/openclaw-monitor.git
cd openclaw-monitor
pnpm install
```

### 配置

1. **修改 OpenClaw 配置**

编辑 `/root/.openclaw/openclaw.json`，将 `baseUrl` 改为本地代理：

```json
{
  "providers": {
    "tencentcodingplan": {
      "baseUrl": "http://localhost:38080/v3"
    }
  }
}
```

2. **启动代理**

```bash
cd packages/proxy
pnpm dev
```

3. **启动后端**

```bash
cd packages/backend
pnpm dev
```

4. **启动前端**

```bash
cd packages/client
pnpm tauri dev
```

### 访问

- 前端界面：自动打开桌面应用
- 后端 API：http://localhost:3000

## API 文档

### REST API

| 端点 | 说明 |
|------|------|
| `GET /api/channels` | 获取渠道列表 |
| `GET /api/chats?channel=xxx` | 获取聊天列表 |
| `GET /api/messages?chat=xxx` | 获取消息列表 |
| `GET /api/operations?message=xxx` | 获取操作详情 |

### WebSocket

```
ws://localhost:3000/ws
```

事件：
- `session:update` - session 文件更新
- `llm:request` - LLM 请求拦截
- `llm:response` - LLM 响应拦截

## 开发进度

- [x] T1 - 创建 GitHub 仓库
- [x] T2 - 编写 README
- [ ] T3 - 软件设计 + 架构图
- [ ] T4 - HTTP 代理
- [ ] T5 - 后端 API
- [ ] T6 - 文件监听 + 实时推送
- [ ] T7 - 前端 UI
- [ ] T8 - 集成测试

## License

MIT
