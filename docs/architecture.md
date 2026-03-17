# 架构设计

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                           OpenClaw Monitor                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │
│  │  Frontend   │◀───│  WebSocket  │◀───│        Backend          │ │
│  │  (Vue 3)    │    │   (Push)    │    │        (Hono)           │ │
│  └─────────────┘    └─────────────┘    └───────────┬─────────────┘ │
│                                                     │               │
│         ┌───────────────────────────────────────────┼───────────┐   │
│         │                                           │           │   │
│         ▼                                           ▼           │   │
│  ┌─────────────┐                          ┌─────────────────┐   │   │
│  │   SQLite    │                          │  File Watcher   │   │   │
│  │ (Persistence)│                          │  (chokidar)     │   │   │
│  └──────┬──────┘                          └────────┬────────┘   │   │
│         │                                          │            │   │
│         │                                          ▼            │   │
│         │                                 ┌─────────────────┐   │   │
│         │                                 │  Cache Trace    │   │   │
│         │                                 │  (Parser)       │   │   │
│         │                                 └────────┬────────┘   │   │
│         │                                          │            │   │
└─────────┼──────────────────────────────────────────┼────────────┘   │
          │                                          │                │
          │                                          ▼                │
          │                                 ┌─────────────────┐       │
          │                                 │  cache-trace.   │       │
          │                                 │  jsonl          │       │
          │                                 └────────┬────────┘       │
          │                                          │                │
          │                                          ▼                │
          │                                 ┌─────────────────┐       │
          └────────────────────────────────▶│    OpenClaw     │       │
                                            └─────────────────┘       │
```

## 模块说明

### 1. Cache Trace Parser

**职责**：解析 Cache Trace 文件，提取 Run 信息

**输入**：`cache-trace.jsonl` 文件

**输出**：Run 对象列表

**关键逻辑**：
- 按 `runId` 分组
- 提取 `stream:context` 作为输入
- 提取 `session:after` 作为输出
- 计算耗时和状态

### 2. File Watcher

**职责**：监听 Cache Trace 文件变更

**实现**：使用 `chokidar` 库

**事件处理**：
- `add`: 文件创建，全量解析
- `change`: 文件变更，增量解析（只解析新增行）

### 3. SQLite Persistence

**职责**：持久化存储 Run 数据

**表结构**：

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
```

### 4. WebSocket Push

**职责**：实时推送 Run 更新到前端

**消息格式**：

```typescript
interface WSMessage {
  type: 'run:started' | 'run:completed' | 'run:updated';
  data: Run;
  seq: number;  // 消息序列号
}
```

**可靠性保证**：
- 本地消息表：未确认的消息存储在 SQLite
- 客户端 ACK：客户端收到消息后发送确认
- 重连恢复：客户端重连时发送 lastSeq，服务端重发未确认消息

**消息表**：

```sql
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

### 5. Backend API

**职责**：提供 REST API

**实现**：使用 Hono 框架

**接口**：

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/runs` | GET | 获取 Run 列表，支持分页 |
| `/api/runs/:runId` | GET | 获取 Run 详情 |
| `/api/runs/:runId/messages` | GET | 获取 Run 的消息列表 |
| `/api/sessions` | GET | 获取 Session 列表 |
| `/ws` | WebSocket | WebSocket 连接 |

### 6. Frontend

**职责**：展示 Run 列表和详情

**实现**：Vue 3 + TypeScript + Vite

**页面**：
- Run 列表页：显示最近的 Run，支持分页
- Run 详情页：显示输入输出消息

## 数据流

### 完整流程

```
1. OpenClaw 调用 LLM
   │
   ├─▶ Cache Trace 记录 stream:context（输入）
   │
   └─▶ LLM 返回响应
        │
        └─▶ Cache Trace 记录 session:after（输出）
             │
             └─▶ File Watcher 检测到变更
                  │
                  ├─▶ Parser 解析新条目
                  │
                  ├─▶ 存储到 SQLite
                  │
                  ├─▶ 存储 WebSocket 消息到消息表
                  │
                  └─▶ 推送 WebSocket 消息
                       │
                       └─▶ Frontend 收到并显示
                            │
                            └─▶ Frontend 发送 ACK
                                 │
                                 └─▶ 更新消息表 acked_at
```

### 增量解析

```
1. 记录当前文件大小
2. 检测到文件变更
3. 只读取新增部分（从上次记录的位置开始）
4. 解析新增行
5. 更新记录的文件大小
```

## 容错设计

### 文件监听失败

- 重试机制：最多重试 3 次
- 降级方案：定时轮询（每 5 秒检查一次文件变更）

### 解析失败

- 记录错误日志
- 跳过错误行，继续解析后续行

### WebSocket 断开

- 客户端自动重连
- 重连后发送 lastSeq，服务端重发未确认消息

### SQLite 写入失败

- 记录错误日志
- 内存缓存未写入的数据
- 定时重试写入

## 性能优化

### 文件解析

- 增量解析：只解析新增部分
- 批量处理：积累一定数量后再写入 SQLite

### 数据库查询

- 索引优化：run_id, session_id, timestamp 都有索引
- 分页查询：避免一次查询过多数据

### WebSocket 推送

- 批量推送：积累一定数量或时间后批量推送
- 节流：避免短时间内推送过多消息

## 安全设计

### 文件路径验证

- 只允许访问特定目录下的文件
- 禁止路径穿越（`..`）

### SQL 注入防护

- 使用参数化查询

### WebSocket 安全

- 只允许本地连接
- 或者使用 Token 认证
