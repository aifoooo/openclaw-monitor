# OpenClaw Monitor 架构文档

## 一、系统定位

**OpenClaw Monitor = OpenClaw 的监控面板**

实时监控 OpenClaw 所有 Agent 的运行状态，让 AI Agent 的行为**可见、可查、可分析**。

---

## 二、核心架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户层                                   │
│                    QQ / 飞书 / 其他渠道                          │
└─────────────────────────────────────────────────────────────────┘
                                ↓ 发送消息
┌─────────────────────────────────────────────────────────────────┐
│                       OpenClaw Agent                            │
│              (mime-qq, mime-feishu, wife-qq 等)                │
│                                                                 │
│  运行时产生:                                                     │
│  - 会话文件: ~/.openclaw/agents/*/sessions/*.jsonl             │
│  - 备份文件: *.jsonl.reset.时间戳                               │
│  - Cache Trace: ~/.openclaw/logs/cache-trace.jsonl             │
└─────────────────────────────────────────────────────────────────┘
                                ↓ 文件变化
┌─────────────────────────────────────────────────────────────────┐
│                       文件监视器                                 │
│                      (chokidar)                                 │
│                                                                 │
│  监听事件:                                                       │
│  - add: 新会话文件创建 → 立即解析并添加到数据库                   │
│  - change: 会话文件修改 → tail 读取最后一行，更新统计数据         │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                       解析层                                     │
│                    (chat 模块)                                  │
│                                                                 │
│  核心函数:                                                       │
│  - parseSessionFile: 解析会话文件，提取消息                      │
│  - extractTitle: 生成聊天标题（时间 + shortId）                  │
│  - getChannelAndAccount: 从 agent 名称映射渠道                   │
│                                                                 │
│  特殊处理:                                                       │
│  - 备份文件检测: .jsonl.reset.* 或 .jsonl.时间戳                 │
│  - 隐藏标记: isHidden = true                                    │
│  - 消息过滤: 排除 toolResult 类型                                │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                       存储层                                     │
│                      (SQLite)                                   │
│                                                                 │
│  核心表:                                                         │
│  - chats: 聊天记录（含 is_hidden 字段）                          │
│  - channels: 渠道配置                                           │
│  - runs: 运行记录                                               │
│  - cache_traces: 缓存追踪                                       │
│  - operations: 操作记录                                         │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                       接口层                                     │
│                   (REST API + WebSocket)                        │
│                                                                 │
│  REST API:                                                      │
│  - GET /api/chats: 获取聊天列表（默认排除 is_hidden）            │
│  - GET /api/chats/:id/messages: 获取消息详情                    │
│  - POST /api/chats/scan: 手动触发扫描                           │
│  - POST /api/chats/sync: 同步会话文件                           │
│                                                                 │
│  WebSocket:                                                     │
│  - new_message: 新消息推送                                       │
│  - run:started: Run 开始                                        │
│  - run:completed: Run 完成                                       │
│  - file_added: 新文件创建（前端刷新聊天列表）                    │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                       展示层                                     │
│                      (Vue 3)                                    │
│                                                                 │
│  核心组件:                                                       │
│  - Home.vue: 主页面，管理 WebSocket 连接                         │
│  - ChatList.vue: 聊天列表，支持选择和刷新                        │
│  - MessageDetail.vue: 消息详情，支持分页加载                     │
│                                                                 │
│  关键逻辑:                                                       │
│  - WebSocket 连接: 建立实时推送                                  │
│  - handleWebSocketMessage: 处理推送消息                          │
│    - file_added → 刷新聊天列表                                  │
│    - new_message → 更新聊天时间和消息                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、核心业务流程

### 3.1 用户发送消息

```
1. 用户 → OpenClaw Agent（QQ/飞书）
2. Agent 追加消息到会话文件
3. 文件监视器检测到 change 事件
4. tail 读取最后一行，解析消息
5. 更新数据库（message_count++, last_message_at）
6. WebSocket 推送 new_message 事件
7. 前端收到推送：
   - 更新聊天时间（变成"刚刚"）
   - 如果当前选中该聊天，追加消息到列表
```

### 3.2 用户执行 /new

```
1. 用户发送 /new 命令
2. Agent 重命名当前会话：xxx.jsonl → xxx.jsonl.reset.时间戳
3. Agent 创建新的空会话文件（相同 sessionId）
4. 文件监视器检测到新文件：
   a. 解析新会话文件
   b. 检测到是备份文件 → 标记 isHidden = true
   c. 检测到是当前会话 → 正常添加
5. 保存到数据库
6. WebSocket 推送 file_added 事件
7. 前端刷新聊天列表：
   - 只显示 is_hidden = false 的聊天
   - 新会话显示在顶部
```

### 3.3 定时同步任务

```
每分钟执行：
1. 扫描所有会话文件（scanAllSessions）
2. 更新数据库（新增缺失的，删除不存在的）
3. 同步聊天时间（从文件修改时间）
4. 清理过期数据
```

---

## 四、关键设计决策

### 4.1 备份文件处理

**问题**：OpenClaw 执行 `/new` 时，会重命名当前会话为备份文件，导致重复显示。

**解决方案**：
- 检测备份文件（`.jsonl.reset.*` 或 `.jsonl.时间戳`）
- 标记为隐藏（`is_hidden = true`）
- 前端默认不显示隐藏会话
- 数据库保留历史记录

### 4.2 文件监视策略

**问题**：如何平衡实时性和性能？

**解决方案**：
- **新文件（add 事件）**：立即解析并添加到数据库
- **文件修改（change 事件）**：只 tail 最后一行，避免读取整个文件
- **定时同步**：每分钟完整扫描一次，确保数据一致性

### 4.3 消息统计准确性

**问题**：toolResult 消息不应该计入 messageCount。

**解决方案**：
- `parseSessionFile`: 排除 `role === 'toolResult'` 的消息
- 只统计用户和助手的对话消息

### 4.4 前端实时性

**问题**：WebSocket 断开后，用户看不到新消息。

**解决方案**：
- 处理 `file_added` 事件，刷新聊天列表
- 处理 `new_message` 事件，更新聊天时间和消息
- **待优化**：增加 WebSocket 自动重连机制

---

## 五、数据流转详解

### 5.1 会话文件格式

```jsonl
{"type":"session","version":3,"id":"uuid","timestamp":"..."}
{"type":"message","id":"...","timestamp":"...","message":{"role":"user","content":[...]}}
{"type":"message","id":"...","timestamp":"...","message":{"role":"assistant","content":[...]}}
{"type":"thinking_level_change","id":"...","timestamp":"...","thinkingLevel":"low"}
```

### 5.2 数据库表结构

```sql
-- 聊天表
CREATE TABLE chats (
  chat_id TEXT UNIQUE NOT NULL,        -- direct:sessionId
  channel_id TEXT NOT NULL,             -- qqbot / feishu
  account_id TEXT NOT NULL,             -- mime / wife
  session_key TEXT,                     -- OpenClaw session key
  title TEXT NOT NULL,                  -- 03-22 21:05 (b16ed9f4)
  last_message_at INTEGER,              -- 最后消息时间戳
  message_count INTEGER DEFAULT 0,      -- 消息数量
  session_file TEXT,                    -- 会话文件路径
  is_hidden INTEGER DEFAULT 0,          -- 是否隐藏（备份文件）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 渠道表
CREATE TABLE channels (
  channel_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  status TEXT,
  accounts TEXT                         -- JSON 数组
);

-- 运行记录表
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  status TEXT,
  model TEXT,
  provider TEXT,
  started_at INTEGER,
  completed_at INTEGER
);
```

---

## 六、测试策略

### 6.1 端到端测试（e2e-full-test.sh）

**测试场景**：
1. 创建新会话 → 聊天列表新增条目
2. 点击第 1-5 个聊天 → 消息加载正常
3. 验证无重复会话（备份不应显示）
4. 检查备份文件不显示

### 6.2 四层验证

```
UI = API = 数据库 = 文件
```

- **UI**：前端聊天列表显示正确
- **API**：返回的数据与数据库一致
- **数据库**：记录完整且准确
- **文件**：会话文件存在且可读

---

## 七、已知问题与优化方向

### 7.1 已解决

- ✅ 备份会话重复显示
- ✅ 新会话不显示（file_added 事件处理）
- ✅ 消息统计不准确（排除 toolResult）
- ✅ 分页逻辑错误

### 7.2 待优化

- ⚠️ WebSocket 自动重连机制
- ⚠️ 大文件性能优化（流式读取）
- ⚠️ 前端缓存策略
- ⚠️ 数据库清理策略

---

## 八、监控与运维

### 8.1 服务状态检查

```bash
# 检查后端服务
systemctl status openclaw-monitor

# 检查数据库
sqlite3 /var/lib/openclaw-monitor/monitor.db "SELECT COUNT(*) FROM chats"

# 检查文件监视器
journalctl -u openclaw-monitor -n 50 | grep MessageWatcher

# 检查 WebSocket 连接
journalctl -u openclaw-monitor -n 50 | grep "Connection"
```

### 8.2 性能指标

- **内存使用**：< 1GB（正常）
- **数据库大小**：< 2GB（可接受）
- **文件监视延迟**：< 2秒（实时）
- **API 响应时间**：< 100ms（快速）

---

## 九、总结

OpenClaw Monitor 通过文件监视器实时监听 OpenClaw Agent 的会话文件变化，解析并存储到 SQLite 数据库，通过 REST API 和 WebSocket 提供数据和实时推送，最终在 Vue 3 前端展示。

**核心价值**：让 OpenClaw 的运行状态"可见、可查、可分析"！
