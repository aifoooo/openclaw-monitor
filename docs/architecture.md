# OpenClaw Monitor 架构设计

> 最后更新：2026-03-18

---

## 一、系统架构

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

## 二、数据模型

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
├── runId: string           # 关联的 Run ID
├── role: string            # 角色：user, assistant, toolResult
├── content: Content[]      # 消息内容（支持多类型）
├── timestamp: number       # 时间戳
├── usage?: Usage           # Token 使用量
└── stopReason?: string     # 停止原因
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

## 三、数据源

### 3.1 Cache Trace

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

### 3.2 Gateway 日志

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

### 3.3 OpenClaw 配置

**位置**：`~/.openclaw/openclaw.json`

**包含信息**：
- 渠道配置：`channels`
- 模型配置：`models.providers`
- 诊断配置：`diagnostics`

### 3.4 Session 文件

**位置**：
- `~/.openclaw/sessions/*.jsonl` - 全局 Session
- `~/.openclaw/qqbot/sessions/*.json` - QQ Bot Session

**包含信息**：
- 消息历史
- Session 元数据

---

## 四、数据流

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

## 五、API 接口

### 5.1 渠道管理

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/channels` | GET | 获取渠道列表 |
| `/api/channels/:channelId` | GET | 获取渠道详情 |
| `/api/channels/refresh` | POST | 刷新渠道信息 |

### 5.2 聊天管理

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/chats` | GET | 获取聊天列表（支持 channelId 过滤） |
| `/api/chats/:chatId` | GET | 获取聊天详情 |
| `/api/chats/:chatId/messages` | GET | 获取聊天消息 |
| `/api/chats/scan` | POST | 扫描聊天 |

### 5.3 Run 管理

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/runs` | GET | 获取 Run 列表（支持分页、排序） |
| `/api/runs/:runId` | GET | 获取 Run 详情 |
| `/api/runs/:runId/operations` | GET | 获取 Run 操作列表 |

### 5.4 系统接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/docs` | GET | API 文档 |
| `/api/stats` | GET | 统计信息 |
| `/api/watcher/status` | GET | Watcher 状态 |

---

## 六、数据库设计

### 6.1 表结构

```sql
-- Cache Trace 原始数据
CREATE TABLE cache_traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  seq INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  raw TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  INDEX idx_run_id (run_id),
  INDEX idx_timestamp (timestamp)
);

-- Run 聚合数据
CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT UNIQUE NOT NULL,
  session_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  workspace_dir TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL,
  input_messages TEXT,
  output_messages TEXT,
  message_count INTEGER DEFAULT 0,
  stages TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  INDEX idx_session_id (session_id),
  INDEX idx_started_at (started_at)
);

-- 渠道
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  accounts TEXT,
  config TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 聊天
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  title TEXT,
  last_message_at INTEGER,
  message_count INTEGER DEFAULT 0,
  session_file TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  INDEX idx_channel_id (channel_id)
);

-- 消息
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  run_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  usage TEXT,
  stop_reason TEXT,
  created_at INTEGER NOT NULL,
  INDEX idx_chat_id (chat_id),
  INDEX idx_run_id (run_id)
);

-- 操作
CREATE TABLE operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  tool_call_id TEXT,
  tool_name TEXT,
  provider TEXT,
  model TEXT,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  duration_ms INTEGER,
  context_size INTEGER,
  created_at INTEGER NOT NULL,
  INDEX idx_run_id (run_id)
);

-- WebSocket 消息
CREATE TABLE ws_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seq INTEGER UNIQUE NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  acked_at INTEGER,
  INDEX idx_seq (seq)
);
```

---

## 七、容错设计

### 7.1 文件监听失败

- 重试机制：最多重试 3 次
- 降级方案：定时轮询（每 5 秒检查一次文件变更）

### 7.2 解析失败

- 记录错误日志
- 跳过错误行，继续解析后续行

### 7.3 WebSocket 断开

- 客户端自动重连
- 重连后发送 lastSeq，服务端重发未确认消息

### 7.4 SQLite 写入失败

- 记录错误日志
- 内存缓存未写入的数据
- 定时重试写入

---

## 八、性能优化

### 8.1 文件解析

- 增量解析：只解析新增部分
- 批量处理：积累一定数量后再写入 SQLite

### 8.2 数据库查询

- 索引优化：run_id, session_id, timestamp 都有索引
- 分页查询：避免一次查询过多数据

### 8.3 WebSocket 推送

- 批量推送：积累一定数量或时间后批量推送
- 节流：避免短时间内推送过多消息

---

## 九、安全设计

### 9.1 文件路径验证

- 只允许访问特定目录下的文件
- 禁止路径穿越（`..`）

### 9.2 SQL 注入防护

- 使用参数化查询

### 9.3 WebSocket 安全

- 只允许本地连接
- 或者使用 Token 认证

### 9.4 API 安全

- 速率限制
- CORS 配置
- 认证中间件

---

## 十、技术栈

| 组件 | 技术 |
|------|------|
| 后端框架 | Hono |
| 前端框架 | Vue 3 + TypeScript |
| 数据库 | SQLite (better-sqlite3) |
| 文件监听 | chokidar |
| WebSocket | 原生 WebSocket |
| 构建工具 | Vite |

---

*最后更新：2026-03-18*
