import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { WebSocketServer, WebSocket } from 'ws';
import routes from './routes';
import { createWatcher } from './watcher';
import fs from 'fs';

const app = express();

// HTTPS 配置
const HTTPS_ENABLED = process.env.HTTPS_ENABLED === 'true';
const HTTPS_KEY = process.env.HTTPS_KEY;
const HTTPS_CERT = process.env.HTTPS_CERT;

// 速率限制配置
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '60000'); // 1 分钟
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '100'); // 每分钟最多 100 次请求

// IP 白名单
const IP_WHITELIST = process.env.IP_WHITELIST?.split(',').map(s => s.trim()).filter(Boolean) || [];

// IP 白名单检查
function checkIpWhitelist(req: any, res: any, next: any) {
  // 如果没有配置白名单，跳过检查
  if (IP_WHITELIST.length === 0) {
    return next();
  }
  
  // 健康检查端点不检查白名单
  if (req.path === '/health' || req.path === '/ready') {
    return next();
  }
  
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  
  // 支持 CIDR 和精确匹配
  const isAllowed = IP_WHITELIST.some(allowed => {
    if (allowed.includes('/')) {
      // CIDR 匹配（简化版，只支持 /24 和 /32）
      const [network, prefix] = allowed.split('/');
      const ipParts = ip.split('.');
      const networkParts = network.split('.');
      
      if (prefix === '32') {
        return ip === network;
      }
      
      if (prefix === '24') {
        return ipParts.slice(0, 3).join('.') === networkParts.slice(0, 3).join('.');
      }
      
      // 其他 CIDR 暂不支持，返回 false
      return false;
    }
    
    return ip === allowed;
  });
  
  if (!isAllowed) {
    console.warn(`[Security] IP not in whitelist: ${ip}`);
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  next();
}

// 简单的速率限制（基于内存）
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function rateLimit(req: any, res: any, next: any) {
  // 健康检查端点不限速
  if (req.path === '/health' || req.path === '/ready') {
    return next();
  }
  
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  
  const record = rateLimitMap.get(ip);
  
  if (!record || now > record.resetTime) {
    // 新窗口
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return next();
  }
  
  if (record.count >= RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: 'Too Many Requests',
      retryAfter: Math.ceil((record.resetTime - now) / 1000),
    });
  }
  
  record.count++;
  next();
}

// 定期清理过期的速率限制记录
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000);

let server: any;
if (HTTPS_ENABLED && HTTPS_KEY && HTTPS_CERT) {
  const httpsOptions = {
    key: fs.readFileSync(HTTPS_KEY),
    cert: fs.readFileSync(HTTPS_CERT),
  };
  server = createHttpsServer(httpsOptions, app);
  console.log('[Backend] HTTPS enabled');
} else {
  server = createServer(app);
}

const wss = new WebSocketServer({ server });

// 状态
const startTime = Date.now();

// Token 认证
const API_TOKEN = process.env.API_TOKEN;

// Token 认证中间件
function requireAuth(req: any, res: any, next: any) {
  // 健康检查端点不需要认证
  if (req.path === '/health' || req.path === '/ready') {
    return next();
  }
  
  // 如果没有配置 Token，跳过认证
  if (!API_TOKEN) {
    console.warn('[Backend] API_TOKEN not configured, authentication disabled');
    return next();
  }
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  
  const token = authHeader.startsWith('Bearer ') 
    ? authHeader.slice(7) 
    : authHeader;
  
  if (token !== API_TOKEN) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  next();
}

// 中间件
const CORS_ORIGIN = process.env.CORS_ORIGIN;

if (CORS_ORIGIN) {
  // 限制指定的源
  const origins = CORS_ORIGIN.split(',').map(s => s.trim());
  app.use(cors({
    origin: origins,
    credentials: true,
  }));
  console.log('[Backend] CORS restricted to:', origins);
} else {
  // 默认全开放（开发环境）
  app.use(cors());
  console.warn('[Backend] CORS is open (not recommended for production)');
}

app.use(express.json());
app.use(checkIpWhitelist); // IP 白名单检查
app.use(rateLimit); // 速率限制
app.use(requireAuth);

// API 路由
app.use('/api', routes);

// WebSocket 连接
const clients = new Set<WebSocket>();
const authenticatedClients = new Set<WebSocket>();

wss.on('connection', (ws, req) => {
  // WebSocket Token 认证
  if (API_TOKEN) {
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const token = url.searchParams.get('token');
    
    if (token !== API_TOKEN) {
      console.warn('[WebSocket] Unauthorized connection attempt');
      ws.close(1008, 'Unauthorized');
      return;
    }
  }
  
  console.log('[WebSocket] Client connected');
  clients.add(ws);
  authenticatedClients.add(ws);
  
  ws.on('close', () => {
    console.log('[WebSocket] Client disconnected');
    clients.delete(ws);
    authenticatedClients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('[WebSocket] Error:', error);
    clients.delete(ws);
    authenticatedClients.delete(ws);
  });
});

// 广播消息
export function broadcast(event: string, data: any) {
  const message = JSON.stringify({ event, data });
  for (const client of authenticatedClients) {
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
