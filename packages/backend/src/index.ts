import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import routes from './routes';
import { createWatcher } from './watcher';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// 状态
const startTime = Date.now();

// 中间件
app.use(cors());
app.use(express.json());

// API 路由
app.use('/api', routes);

// WebSocket 连接
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  console.log('[WebSocket] Client connected');
  clients.add(ws);
  
  ws.on('close', () => {
    console.log('[WebSocket] Client disconnected');
    clients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('[WebSocket] Error:', error);
    clients.delete(ws);
  });
});

// 广播消息
export function broadcast(event: string, data: any) {
  const message = JSON.stringify({ event, data });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// 健康检查
app.get('/health', (req, res) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const memUsage = process.memoryUsage();
  
  res.json({
    status: 'ok',
    uptime,
    uptimeHuman: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`,
    websocketClients: clients.size,
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024),
    },
  });
});

// 就绪检查
app.get('/ready', (req, res) => {
  res.json({ ready: true });
});

// 启动服务器
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`[Backend] Server started on http://localhost:${PORT}`);
  console.log(`[Backend] WebSocket available at ws://localhost:${PORT}`);
  
  // 启动文件监听
  createWatcher((data) => {
    // 广播 session 更新
    broadcast('session:update', data);
  });
});

// 优雅关闭
let isShuttingDown = false;

function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`[Backend] Received ${signal}, shutting down gracefully...`);
  
  // 关闭所有 WebSocket 连接
  for (const client of clients) {
    client.close();
  }
  
  // 停止接受新连接
  server.close(() => {
    console.log('[Backend] Server closed');
    process.exit(0);
  });
  
  // 强制退出超时
  setTimeout(() => {
    console.error('[Backend] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { app, server };
