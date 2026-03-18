# OpenClaw Monitor

实时监控 OpenClaw 运行状态，追踪每次请求的操作细节。

## 背景

OpenClaw 在处理消息时，可能出现响应缓慢或无响应的情况，传统排查方式难以定位问题。

**痛点**：
- 任务执行状态不透明
- 无法定位性能瓶颈
- 难以追踪故障环节

本项目通过解析 **Cache Trace** 和 **Gateway 日志**，追踪每次请求的完整操作细节，提供可视化监控界面。

---

## 功能特性

| 功能 | 说明 |
|------|------|
| 渠道管理 | 查看已配置的渠道列表，切换当前渠道 |
| 聊天列表 | 查看当前渠道下的所有聊天 |
| 消息详情 | 查看用户发送的消息和助手回复 |
| 操作追踪 | 追踪每次请求触发的所有操作（LLM 调用、工具执行） |
| 性能分析 | 显示每个操作的耗时、Token 使用量 |
| 实时更新 | 文件变更自动推送，无需手动刷新 |

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
      "includePrompt": false,
      "includeSystem": false
    }
  }
}
```

> **优化建议**：关闭 `includePrompt` 和 `includeSystem` 可减少 90% 文件大小。

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
git clone https://github.com/aifoooo/openclaw-monitor.git
cd openclaw-monitor
pnpm install
```

### 启动开发服务器

**方式一：同时启动前后端（推荐）**

```bash
pnpm dev
```

启动后：
- 后端：http://localhost:3000
- 前端：http://localhost:5173

**方式二：分别启动**

```bash
pnpm dev:backend  # 后端（带热重载）
pnpm dev:client   # 前端（带 HMR）
```

**方式三：只启动前端（连接远程后端）**

编辑 `packages/client/vite.config.ts`：

```typescript
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://your-server-ip:3000',  // 改为服务器地址
        changeOrigin: true,
      },
    },
  },
});
```

然后启动前端：

```bash
pnpm dev:client
```

### 构建生产版本

```bash
pnpm build
```

---

## 项目结构

```
openclaw-monitor/
├── packages/
│   ├── backend/          # 后端服务
│   │   ├── src/
│   │   │   ├── index.ts       # 入口
│   │   │   ├── db/            # 数据库操作
│   │   │   ├── watcher/       # 文件监听
│   │   │   ├── parser/        # 日志解析
│   │   │   ├── routes/        # API 路由
│   │   │   └── ws/            # WebSocket
│   │   └── package.json
│   ├── client/           # 前端应用（Vue 3）
│   │   ├── src/
│   │   │   ├── views/         # 页面
│   │   │   ├── components/    # 组件
│   │   │   ├── services/      # API 调用
│   │   │   ├── router/        # 路由
│   │   │   └── stores/        # 状态管理
│   │   └── vite.config.ts
│   └── frontend/         # 静态文件（构建产物）
└── docs/                 # 文档
    ├── architecture.md
    └── images/           # 架构图
```

---

## 配置

### 环境变量

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `OPENCLAW_DIR` | `/root/.openclaw` | OpenClaw 配置目录 |
| `DB_PATH` | `/var/lib/openclaw-monitor/monitor.db` | 数据库路径 |
| `PORT` | `3000` | 后端 API 端口 |

### Cache Trace 优化配置

推荐配置（减少 90% 文件大小）：

```json
{
  "diagnostics": {
    "enabled": true,
    "cacheTrace": {
      "enabled": true,
      "includeMessages": true,
      "includePrompt": false,
      "includeSystem": false
    }
  }
}
```

---

## 部署

### systemd 服务部署

1. **创建数据目录**

```bash
mkdir -p /var/lib/openclaw-monitor
```

2. **创建服务文件**

`/etc/systemd/system/openclaw-monitor.service`：

```ini
[Unit]
Description=OpenClaw Monitor
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/path/to/openclaw-monitor/packages/backend
Environment="PATH=/root/.nvm/versions/node/v22.22.1/bin:/usr/local/bin:/usr/bin:/bin"
Environment="NODE_PATH=/path/to/openclaw-monitor/packages/backend/node_modules"
Environment="OPENCLAW_DIR=/root/.openclaw"
Environment="DB_PATH=/var/lib/openclaw-monitor/monitor.db"
Environment="PORT=3000"
ExecStart=/root/.nvm/versions/node/v22.22.1/bin/node /path/to/openclaw-monitor/packages/backend/node_modules/tsx/dist/cli.mjs src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

3. **启动服务**

```bash
systemctl daemon-reload
systemctl start openclaw-monitor
systemctl enable openclaw-monitor
```

### 数据清理

#### Cache Trace 日志轮转

创建 `/etc/cron.daily/openclaw-cache-trace-cleanup`：

```bash
#!/bin/bash
LOG_DIR="/root/.openclaw/logs"
MAX_MINUTES=720  # 12小时
MAX_SIZE_MB=500

find "$LOG_DIR" -name "cache-trace-*.jsonl" -mmin +$MAX_MINUTES -delete 2>/dev/null

if [ -f "$LOG_DIR/cache-trace.jsonl" ]; then
  SIZE_MB=$(du -m "$LOG_DIR/cache-trace.jsonl" | cut -f1)
  if [ "$SIZE_MB" -gt "$MAX_SIZE_MB" ]; then
    mv "$LOG_DIR/cache-trace.jsonl" "$LOG_DIR/cache-trace-$(date +%Y%m%d%H%M%S).jsonl"
    touch "$LOG_DIR/cache-trace.jsonl"
  fi
fi
```

#### 数据库清理

创建 `/etc/cron.daily/openclaw-monitor-db-cleanup`：

```bash
#!/bin/bash
DB_PATH="/var/lib/openclaw-monitor/monitor.db"
DAYS_TO_KEEP=30

sqlite3 "$DB_PATH" "DELETE FROM runs WHERE started_at < strftime('%s', 'now', '-${DAYS_TO_KEEP} days') * 1000;"
sqlite3 "$DB_PATH" "DELETE FROM ws_messages WHERE acked_at IS NOT NULL AND id < (SELECT COALESCE(MAX(id), 0) FROM ws_messages WHERE acked_at IS NOT NULL) - 1000;"
sqlite3 "$DB_PATH" "VACUUM;"
```

---

## 架构设计

![系统架构](docs/images/openclaw-monitor-arch.png)

详细文档：[架构设计](docs/architecture.md)

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 后端框架 | Hono |
| 前端框架 | Vue 3 + TypeScript |
| 数据库 | SQLite (better-sqlite3) |
| 文件监听 | chokidar |
| WebSocket | 原生 WebSocket |
| 构建工具 | Vite |

---

## API 接口

### 健康检查

```bash
GET /health
```

### 渠道管理

```bash
GET /api/channels           # 获取渠道列表
GET /api/channels/:id       # 获取渠道详情
POST /api/channels/refresh  # 刷新渠道信息
```

### 聊天管理

```bash
GET /api/chats              # 获取聊天列表
GET /api/chats/:id          # 获取聊天详情
GET /api/chats/:id/messages # 获取聊天消息
```

### Run 管理

```bash
GET /api/runs               # 获取 Run 列表
GET /api/runs/:id           # 获取 Run 详情
GET /api/runs/:id/operations # 获取操作列表
```

---

## 开发状态

### 已完成

- Cache Trace 解析（LLM 输入输出）
- Gateway 日志解析（工具执行追踪）
- 渠道管理功能
- 聊天列表功能
- 消息详情功能
- 操作追踪时间线
- WebSocket 实时推送
- 安全加固（认证、速率限制、CORS）
- 数据库设计优化（移除原始数据存储）
- systemd 服务部署
- 数据清理策略
- 单元测试（11 个用例，100% 通过）

### 进行中

- 性能分析图表优化
- Token 使用量图表
- 成本统计图表

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 同时启动前后端 |
| `pnpm dev:client` | 只启动前端 |
| `pnpm dev:backend` | 只启动后端 |
| `pnpm build` | 构建生产版本 |
| `pnpm test` | 运行测试 |

---

## 文档

- [架构设计](docs/architecture.md) - 系统架构、数据模型、数据流
- [测试报告](docs/test-report-final.md) - 测试覆盖和结果

---

## License

MIT
