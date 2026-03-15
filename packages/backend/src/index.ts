import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import routes from './routes';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

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
  res.json({ status: 'ok' });
});

// 启动服务器
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`[Backend] Server started on http://localhost:${PORT}`);
  console.log(`[Backend] WebSocket available at ws://localhost:${PORT}`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('[Backend] Shutting down...');
  server.close(() => {
    console.log('[Backend] Server closed');
    process.exit(0);
  });
});

export { app, server };
