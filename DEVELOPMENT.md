# 开发指南

## 技术栈

| 组件 | 技术 | 版本 |
|------|------|------|
| 后端框架 | Hono | ^4.0.0 |
| 前端框架 | Vue 3 | ^3.4.0 |
| 数据库 | better-sqlite3 | ^9.0.0 |
| 文件监听 | chokidar | ^3.5.0 |
| WebSocket | @hono/node-ws | ^0.0.1 |
| 构建工具 | Vite | ^5.0.0 |
| 包管理 | pnpm | ^8.0.0 |

## 目录结构

```
openclaw-monitor/
├── packages/
│   ├── backend/              # 后端服务
│   │   ├── src/
│   │   │   ├── index.ts      # 入口文件
│   │   │   ├── parser/       # Cache Trace 解析
│   │   │   │   └── index.ts
│   │   │   ├── routes/       # API 路由
│   │   │   │   └── index.ts
│   │   │   ├── watcher/      # 文件监听
│   │   │   │   └── index.ts
│   │   │   ├── db/           # 数据库操作
│   │   │   │   └── index.ts
│   │   │   ├── ws/           # WebSocket
│   │   │   │   └── index.ts
│   │   │   └── types.ts      # 类型定义
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── client/               # 前端应用
│       ├── src/
│       │   ├── main.ts       # 入口文件
│       │   ├── App.vue       # 根组件
│       │   ├── components/   # 组件
│       │   ├── views/        # 页面
│       │   ├── services/     # 服务
│       │   │   ├── api.ts    # API 服务
│       │   │   └── ws.ts     # WebSocket 服务
│       │   └── router/       # 路由
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
│
├── docs/                     # 文档
│   ├── architecture.md
│   └── security.md
│
├── scripts/                  # 脚本
│   ├── install.sh
│   └── uninstall.sh
│
├── tests/                    # 测试
│   ├── unit/
│   └── integration/
│
├── package.json
├── README.md
└── DEVELOPMENT.md
```

## 开发环境

### 安装依赖

```bash
pnpm install
```

### 启动开发服务器

```bash
pnpm dev
```

这将同时启动：
- 后端服务：http://localhost:3000
- 前端服务：http://localhost:5173

### 构建

```bash
pnpm build
```

### 测试

```bash
pnpm test
```

## 核心模块开发

### 1. Cache Trace Parser

位置：`packages/backend/src/parser/index.ts`

职责：解析 Cache Trace 文件

关键函数：
- `parseCacheTraceFile()`: 解析文件
- `parseCacheTraceByRuns()`: 按 runId 分组
- `convertToRun()`: 转换为 Run 对象
- `getRecentRuns()`: 获取最近的 Runs
- `getRunById()`: 获取特定 Run

### 2. File Watcher

位置：`packages/backend/src/watcher/index.ts`

职责：监听文件变更

实现：
```typescript
import chokidar from 'chokidar';

export function startWatcher(filePath: string, on change: (newLines: string[]) => void) {
  let lastSize = 0;
  
  const watcher = chokidar.watch(filePath, {
    persistent: true,
    ignoreInitial: false,
  });
  
  watcher.on('add', async () => {
    const stat = await fs.promises.stat(filePath);
    lastSize = stat.size;
  });
  
  watcher.on('change', async () => {
    const stat = await fs.promises.stat(filePath);
    const newSize = stat.size;
    
    if (newSize > lastSize) {
      const fd = await fs.promises.open(filePath, 'r');
      const buffer = Buffer.alloc(newSize - lastSize);
      await fd.read(buffer, 0, buffer.length, lastSize);
      await fd.close();
      
      const newLines = buffer.toString().split('\n').filter(l => l.trim());
      onChange(newLines);
    }
    
    lastSize = newSize;
  });
  
  return watcher;
}
```

### 3. Database

位置：`packages/backend/src/db/index.ts`

职责：SQLite 操作

关键函数：
- `initDB()`: 初始化数据库
- `saveRun()`: 保存 Run
- `getRuns()`: 获取 Runs
- `getRunById()`: 获取特定 Run
- `saveWSMessage()`: 保存 WebSocket 消息
- `getUnackedMessages()`: 获取未确认消息
- `ackMessage()`: 确认消息

### 4. WebSocket

位置：`packages/backend/src/ws/index.ts`

职责：WebSocket 推送

实现：
```typescript
import { createNodeWebSocket } from '@hono/node-ws';

export function createWSApp(app: Hono) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  
  // 消息推送
  function broadcast(type: string, data: any) {
    const seq = nextSeq();
    const message = { type, data, seq };
    
    // 保存到消息表
    saveWSMessage(seq, type, data);
    
    // 推送到所有连接
    for (const ws of connections) {
      ws.send(JSON.stringify(message));
    }
  }
  
  // WebSocket 路由
  app.get('/ws', upgradeWebSocket(() => ({
    onOpen(event, ws) {
      connections.add(ws);
    },
    onClose(event, ws) {
      connections.delete(ws);
    },
    onMessage(event, ws) {
      const data = JSON.parse(event.data.toString());
      
      if (data.type === 'ack') {
        ackMessage(data.seq);
      }
      
      if (data.type === 'reconnect') {
        // 重发未确认消息
        const messages = getUnackedMessages(data.lastSeq);
        for (const msg of messages) {
          ws.send(JSON.stringify(msg));
        }
      }
    },
  })));
}
```

### 5. Frontend

位置：`packages/client/src/`

关键组件：
- `RunList.vue`: Run 列表
- `RunDetail.vue`: Run 详情
- `MessageView.vue`: 消息展示

WebSocket 服务：
```typescript
export function useWebSocket() {
  const ws = ref<WebSocket | null>(null);
  const runs = ref<Run[]>([]);
  
  function connect() {
    ws.value = new WebSocket('ws://localhost:3000/ws');
    
    ws.value.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'run:started') {
        runs.value.unshift(data.data);
      }
      
      if (data.type === 'run:completed') {
        const index = runs.value.findIndex(r => r.id === data.data.id);
        if (index !== -1) {
          runs.value[index] = data.data;
        }
      }
      
      // 发送 ACK
      ws.value?.send(JSON.stringify({ type: 'ack', seq: data.seq }));
    };
    
    ws.value.onclose = () => {
      setTimeout(connect, 1000);
    };
  }
  
  return { runs, connect };
}
```

## 测试

### 单元测试

位置：`tests/unit/`

测试内容：
- Parser 解析逻辑
- Database 操作
- WebSocket 消息处理

### 集成测试

位置：`tests/integration/`

测试内容：
- API 接口测试
- WebSocket 连接测试
- 完整流程测试

## 部署

### systemd 服务

```ini
[Unit]
Description=OpenClaw Monitor
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/openclaw-monitor
ExecStart=/usr/bin/node packages/backend/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 环境变量

```bash
OPENCLAW_DIR=/root/.openclaw
CACHE_TRACE_PATH=/root/.openclaw/logs/cache-trace.jsonl
DB_PATH=/var/lib/openclaw-monitor/monitor.db
PORT=3000
WS_PORT=3001
```

## 调试

### 后端调试

```bash
# 启用调试日志
LOG_LEVEL=debug pnpm dev:backend
```

### 前端调试

浏览器开发者工具，查看 Network 和 Console。

### 数据库调试

```bash
sqlite3 /var/lib/openclaw-monitor/monitor.db
```

## 常见问题

### Q: Cache Trace 文件不存在？

确保 OpenClaw 配置中启用了 Cache Trace：
```json
{
  "diagnostics": {
    "cacheTrace": { "enabled": true }
  }
}
```

### Q: WebSocket 连接失败？

检查端口是否被占用，或防火墙是否阻止。

### Q: 数据库写入失败？

检查目录权限：
```bash
mkdir -p /var/lib/openclaw-monitor
chmod 755 /var/lib/openclaw-monitor
```
