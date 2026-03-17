# OpenClaw Monitor

实时监控 OpenClaw 运行状态，追踪每次请求的操作细节。

## 背景

向 OpenClaw 发送消息后，响应缓慢或无响应的情况时有发生。

**核心痛点**：
- 不知道龙虾在干嘛
- 任务执行状态不透明
- 无法定位性能瓶颈
- 难以追踪故障环节

本项目通过 **解析 Cache Trace + Gateway 日志**，追踪每次请求的完整操作细节。

---

## 功能特性

### 核心功能

| 功能 | 说明 | 数据源 |
|------|------|--------|
| 📋 渠道管理 | 查看已配置的渠道列表，切换当前渠道 | `openclaw.json` → `channels` |
| 💬 聊天列表 | 查看当前渠道下的所有聊天 | `sessions/*.jsonl` |
| 📝 消息详情 | 查看用户发送的消息和助手回复 | `sessions/*.jsonl` |
| 🔍 操作追踪 | 追踪每次请求触发的所有操作 | Gateway 日志 + Cache Trace |
| 📊 性能分析 | 显示每个操作的耗时、Token 使用量 | Cache Trace |
| 🔄 实时更新 | 文件变更自动推送，无需手动刷新 | WebSocket |

### 操作追踪范围

| 操作类型 | 信息 | 数据源 |
|---------|------|--------|
| **LLM 调用** | provider, model, 耗时, Token 用量, cost | Cache Trace |
| **工具执行** | toolCallId, toolName, 开始/结束时间 | Gateway 日志 (DEBUG) |
| **上下文大小** | messages 数量, 字符数统计 | Gateway 日志 (DEBUG) |

---

## 数据模型

```
Channel (渠道)
├── id: string              # 渠道标识，如 "qqbot"
├── name: string            # 显示名称，如 "QQ Bot"
├── type: string            # 类型：qqbot, feishu, discord
├── status: string          # 状态：online, offline
├── accounts: Account[]     # 账号列表
└── config: any             # 原始配置
    │
    │ 1:N
    ▼
Chat (聊天)
├── id: string              # 聊天 ID
├── channelId: string       # 所属渠道
├── sessionKey: string      # OpenClaw session key
├── title: string           # 聊天标题（用户名/群名）
├── lastMessageAt: number   # 最后消息时间戳
├── messageCount: number    # 消息数量
└── sessionFile: string     # session 文件路径
    │
    │ 1:N
    ▼
Message (消息)
├── id: string              # 消息 ID
├── chatId: string          # 所属聊天
├── role: string            # 角色：user, assistant, tool
├── content: string         # 消息内容
├── timestamp: number       # 时间戳
└── runId: string           # 关联的 Run ID
    │
    │ 1:N
    ▼
Run (一次请求)
├── id: string              # Run ID
├── sessionId: string       # Session ID
├── sessionKey: string      # Session Key
├── provider: string        # LLM provider
├── modelId: string         # 模型 ID
├── startedAt: number       # 开始时间
├── completedAt: number     # 完成时间
├── status: string          # 状态：running, completed, failed
├── messageCount: number    # 消息数量
│
├── inputMessages[]         # 输入消息（来自 Cache Trace）
├── outputMessages[]        # 输出消息（来自 Cache Trace）
│
├── operations[]            # 操作列表
│   ├── LLM 调用
│   │   ├── type: "llm"
│   │   ├── provider, model
│   │   ├── durationMs
│   │   └── contextSize
│   └── 工具执行
│       ├── type: "tool"
│       ├── toolCallId
│       ├── toolName (exec, read, write, etc.)
│       ├── startTime, endTime
│       └── duration
│
└── 统计信息
    ├── totalDuration
    ├── llmCalls: number
    ├── toolCalls: number
    ├── tokenUsage: { input, output, total }
    └── cost: number
```

---

## 数据源

### 1. Cache Trace

**位置**：`~/.openclaw/logs/cache-trace.jsonl`

**Stage 类型**：

| Stage | 说明 | 包含信息 |
|-------|------|----------|
| `session:loaded` | Session 加载 | sessionId, sessionKey |
| `session:sanitized` | Session 清理 | - |
| `session:limited` | Session 限制 | messageCount |
| `prompt:before` | Prompt 处理前 | - |
| `prompt:images` | 图片处理 | - |
| `stream:context` | LLM 输入 | **messages[], provider, modelId** |
| `session:after` | LLM 输出 | **messages[], usage, cost** |

### 2. Gateway 日志

**位置**：`/tmp/openclaw/openclaw-*.log`

**需要配置 DEBUG 级别**：

```json
{
  "logging": {
    "level": "debug"
  }
}
```

**包含信息**：

| 日志类型 | 示例 | 说明 |
|---------|------|------|
| 工具执行开始 | `embedded run tool start: tool=exec toolCallId=xxx` | 工具名称、ID |
| 工具执行结束 | `embedded run tool end: tool=exec toolCallId=xxx` | 计算耗时 |
| LLM 调用开始 | `embedded run start: provider=xxx model=xxx` | provider, model |
| LLM 调用结束 | `embedded run prompt end: durationMs=xxx` | 耗时 |
| 上下文诊断 | `[context-diag] messages=73 historyTextChars=101940` | 上下文大小 |

### 3. OpenClaw 配置

**位置**：`~/.openclaw/openclaw.json`

**包含信息**：
- 渠道配置：`channels`
- 模型配置：`models.providers`
- 诊断配置：`diagnostics`

### 4. Session 文件

**位置**：
- `~/.openclaw/sessions/*.jsonl` - 全局 Session
- `~/.openclaw/qqbot/sessions/*.json` - QQ Bot Session

**包含信息**：
- 消息历史
- Session 元数据

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenClaw Monitor                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    数据采集层                             │  │
│  │                                                          │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │  │
│  │  │   Watcher   │  │   Parser    │  │   Merger    │      │  │
│  │  │  (文件监听) │  │  (日志解析) │  │  (数据合并) │      │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘      │  │
│  │         │                │                │              │  │
│  │         ▼                ▼                ▼              │  │
│  │  ┌────────────────────────────────────────────────┐     │  │
│  │  │            数据源                               │     │  │
│  │  │  • Cache Trace (LLM 输入输出)                  │     │  │
│  │  │  • Gateway 日志 (工具执行、耗时)               │     │  │
│  │  │  • OpenClaw 配置 (渠道、模型)                  │     │  │
│  │  │  • Session 文件 (消息历史)                     │     │  │
│  │  └────────────────────────────────────────────────┘     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    数据存储层                             │  │
│  │                                                          │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │  │
│  │  │   Channel   │  │    Chat     │  │   Message   │      │  │
│  │  │   (渠道)    │  │   (聊天)    │  │   (消息)    │      │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │  │
│  │                                                          │  │
│  │  ┌─────────────────────────────────────────────────┐    │  │
│  │  │                    Run (请求)                    │    │  │
│  │  │  • 基本信息 (runId, sessionId, provider, model) │    │  │
│  │  │  • 消息 (inputMessages, outputMessages)         │    │  │
│  │  │  • 操作 (operations: llm, tool)                 │    │  │
│  │  │  • 统计 (duration, tokens, cost)                │    │  │
│  │  └─────────────────────────────────────────────────┘    │  │
│  │                                                          │  │
│  │  ┌─────────────┐                                        │  │
│  │  │   SQLite    │                                        │  │
│  │  │  (持久化)   │                                        │  │
│  │  └─────────────┘                                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    API 服务层                             │  │
│  │                                                          │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │  │
│  │  │  REST API   │  │  WebSocket  │  │   Health    │      │  │
│  │  │  (Hono)     │  │  (实时推送) │  │  (健康检查) │      │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    前端展示层                             │  │
│  │                                                          │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │  │
│  │  │ 渠道管理    │  │ 聊天列表    │  │ 消息详情    │      │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │  │
│  │                                                          │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │  │
│  │  │ 操作追踪    │  │ 性能分析    │  │ 实时更新    │      │  │
│  │  │ (时间线)    │  │ (图表)      │  │ (WebSocket) │      │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 数据流

```
1. 数据采集
   ├── Watcher 监听文件变更
   │   ├── Cache Trace 变更 → 解析 LLM 输入输出
   │   ├── Gateway 日志变更 → 解析工具执行
   │   └── Session 文件变更 → 解析消息历史
   │
   └── Merger 合并数据
       └── 按 runId 关联 Cache Trace + Gateway 日志

2. 数据存储
   ├── 解析渠道信息 → Channel 表
   ├── 解析 Session → Chat 表
   ├── 解析消息 → Message 表
   └── 解析 Run → Run 表 + Operation 表

3. 实时推送
   ├── WebSocket 推送变更
   │   ├── run:started
   │   ├── run:completed
   │   └── run:updated
   └── 前端实时更新

4. 前端展示
   ├── 渠道列表 → 选择渠道
   ├── 聊天列表 → 选择聊天
   ├── 消息列表 → 查看消息
   └── Run 详情 → 操作时间线 + 性能分析
```

---

## API 接口

### 渠道管理

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/channels` | GET | 获取渠道列表 |
| `/api/channels/:channelId` | GET | 获取渠道详情 |

### 聊天管理

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/chats` | GET | 获取聊天列表 |
| `/api/chats/:chatId` | GET | 获取聊天详情 |
| `/api/chats/:chatId/messages` | GET | 获取聊天消息 |

### Run 管理

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/runs` | GET | 获取 Run 列表 |
| `/api/runs/:runId` | GET | 获取 Run 详情 |
| `/api/runs/:runId/operations` | GET | 获取 Run 操作列表 |
| `/api/runs/:runId/messages` | GET | 获取 Run 消息列表 |

### 系统接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/docs` | GET | API 文档 |
| `/api/watcher/status` | GET | Watcher 状态 |

---

## 快速开始

### 前置条件

1. **OpenClaw 已配置 Cache Trace**

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

2. **OpenClaw 已配置 DEBUG 日志级别**

```json
{
  "logging": {
    "level": "debug"
  }
}
```

3. **Node.js 22+**

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
| `GATEWAY_LOG_PATH` | `/tmp/openclaw/openclaw-*.log` | Gateway 日志路径 |
| `DB_PATH` | `/var/lib/openclaw-monitor/monitor.db` | SQLite 数据库路径 |
| `PORT` | `3000` | 后端 API 端口 |

---

## 开发状态

### ✅ 已完成

- [x] Cache Trace 解析
- [x] Run 基本模型
- [x] REST API
- [x] WebSocket 实时推送
- [x] 基础前端界面
- [x] 安全加固（认证、速率限制）

### 🚧 进行中

- [ ] Gateway 日志解析（工具执行追踪）
- [ ] 数据合并（Cache Trace + Gateway 日志）

### 📋 待开发

- [ ] 渠道管理功能
- [ ] 聊天列表功能
- [ ] 消息详情功能
- [ ] 操作追踪时间线
- [ ] 性能分析图表

---

## 许可证

MIT
