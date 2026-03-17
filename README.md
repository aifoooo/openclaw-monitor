# OpenClaw Monitor

实时监控 OpenClaw 运行状态，追踪每次 LLM 调用的输入输出。

## 背景

向 OpenClaw 发送消息后，响应缓慢或无响应的情况时有发生。

**核心痛点**：
- 不知道龙虾在干嘛
- 任务执行状态不透明
- 无法定位性能瓶颈
- 难以追踪故障环节

本项目通过 **解析 OpenClaw Cache Trace 日志**，追踪每次 LLM 调用的完整输入输出。

## 功能特性

| 功能 | 说明 |
|------|------|
| 📊 Run 列表 | 查看最近的 LLM 调用列表 |
| 🔍 输入追踪 | 查看发送给模型的完整 messages |
| 📤 输出追踪 | 查看模型返回的完整响应 |
| 📈 性能分析 | 显示每次调用的耗时 |
| 🔄 实时更新 | 文件变更自动推送，无需手动刷新 |
| 💾 持久化存储 | SQLite 存储，支持历史查询 |

## 技术架构

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   OpenClaw      │────▶│  Cache Trace    │────▶│   Backend       │
│   (LLM Agent)   │     │  (JSONL File)   │     │   (Parser)      │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                        ┌────────────────────────────────┘
                        │
                        ▼
               ┌─────────────────┐     ┌─────────────────┐
               │     SQLite      │◀────│    WebSocket    │
               │   (Persistence) │     │    (Push)       │
               └─────────────────┘     └────────┬────────┘
                                                │
                        ┌───────────────────────┘
                        │
                        ▼
               ┌─────────────────┐
               │     Frontend    │
               │   (Vue 3 + TS)  │
               └─────────────────┘
```

## 数据流

```
1. OpenClaw 调用 LLM
      │
      ▼
2. Cache Trace 记录 stream:context（输入）
      │
      ▼
3. LLM 返回响应
      │
      ▼
4. Cache Trace 记录 session:after（输出）
      │
      ▼
5. Backend 监听文件变更，解析新条目
      │
      ▼
6. 存储到 SQLite，推送 WebSocket 消息
      │
      ▼
7. Frontend 实时显示
```

## 快速开始

### 前置条件

1. **OpenClaw 已配置 Cache Trace**

确保 `~/.openclaw/openclaw.json` 中启用了 Cache Trace：

```json
{
  "diagnostics": {
    "enabled": true,
    "cacheTrace": {
      "enabled": true,
      "includeMessages": true,
      "includePrompt": true,
      "includeSystem": true
    }
  }
}
```

2. **Node.js 18+**

### 安装

```bash
# 克隆项目
git clone https://github.com/aifoooo/openclaw-monitor.git
cd openclaw-monitor

# 安装依赖
pnpm install

# 构建
pnpm build

# 启动
pnpm dev
```

### 配置

环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENCLAW_DIR` | `/root/.openclaw` | OpenClaw 配置目录 |
| `CACHE_TRACE_PATH` | `~/.openclaw/logs/cache-trace.jsonl` | Cache Trace 文件路径 |
| `DB_PATH` | `/var/lib/openclaw-monitor/monitor.db` | SQLite 数据库路径 |
| `PORT` | `3000` | 后端 API 端口 |
| `WS_PORT` | `3001` | WebSocket 端口 |

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/runs` | GET | 获取最近的 Run 列表 |
| `/api/runs/:runId` | GET | 获取 Run 详情 |
| `/api/runs/:runId/messages` | GET | 获取 Run 的消息列表 |
| `/api/sessions` | GET | 获取 Session 列表 |
| `/api/sessions/:sessionId` | GET | 获取 Session 详情 |

## WebSocket 消息

| 类型 | 说明 |
|------|------|
| `run:started` | 新 Run 开始 |
| `run:completed` | Run 完成 |
| `run:updated` | Run 更新 |

## 开发

```bash
# 开发模式
pnpm dev

# 构建
pnpm build

# 测试
pnpm test
```

## 目录结构

```
openclaw-monitor/
├── packages/
│   ├── backend/          # 后端服务
│   │   └── src/
│   │       ├── parser/   # Cache Trace 解析
│   │       ├── routes/   # API 路由
│   │       ├── watcher/  # 文件监听
│   │       └── index.ts
│   └── client/           # 前端应用
│       └── src/
│           ├── components/
│           ├── views/
│           └── services/
├── docs/                 # 文档
├── scripts/              # 脚本
└── tests/                # 测试
```

## 许可证

MIT
