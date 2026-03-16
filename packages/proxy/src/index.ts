import http from 'http';
import https from 'https';
import httpProxy from 'http-proxy';
import fs from 'fs';
import path from 'path';
import { loadRoutes, matchRoute, getAllProviders } from './router';

// 配置
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '38080');
const LOG_DIR = process.env.LOG_DIR || '/var/log/openclaw-monitor';
const LOG_ROTATION_DAYS = parseInt(process.env.LOG_ROTATION_DAYS || '7');
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3');
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY || '1000');
const LOG_SENSITIVE_DATA = process.env.LOG_SENSITIVE_DATA === 'true';

// 连接池配置
const KEEP_ALIVE = process.env.KEEP_ALIVE !== 'false';
const MAX_SOCKETS = parseInt(process.env.MAX_SOCKETS || '50');
const MAX_FREE_SOCKETS = parseInt(process.env.MAX_FREE_SOCKETS || '10');
const TIMEOUT = parseInt(process.env.TIMEOUT || '30000');

// 为每个 provider 创建独立的连接池
const agentPool: Record<string, https.Agent> = {};

function getAgent(target: string): https.Agent {
  const host = new URL(target).host;
  
  if (!agentPool[host]) {
    agentPool[host] = new https.Agent({
      keepAlive: KEEP_ALIVE,
      maxSockets: MAX_SOCKETS,
      maxFreeSockets: MAX_FREE_SOCKETS,
      timeout: TIMEOUT,
    });
  }
  
  return agentPool[host];
}

// 状态
const startTime = Date.now();
let requestCount = 0;
let errorCount = 0;
let lastRequestTime: number | null = null;
let lastHeartbeat: number = Date.now();
let isHealthy = true;

// 异步确保日志目录存在
async function ensureLogDir() {
  try {
    await fs.promises.access(LOG_DIR);
  } catch {
    await fs.promises.mkdir(LOG_DIR, { recursive: true });
  }
}

// 获取日志文件路径
function getLogFilePath(): string {
  const date = new Date().toISOString().split('T')[0];
  return path.join(LOG_DIR, `llm-${date}.jsonl`);
}

// 脱敏敏感数据
function sanitizeData(data: any): any {
  if (!LOG_SENSITIVE_DATA) {
    if (typeof data === 'string') {
      return data.length > 100 ? `[${data.length} chars, logging disabled]` : '[logging disabled]';
    }
    if (typeof data === 'object' && data !== null) {
      return '[object, logging disabled]';
    }
  }
  return data;
}

// 脱敏消息内容
function sanitizeMessages(messages: any[]): any[] {
  if (!LOG_SENSITIVE_DATA || !Array.isArray(messages)) {
    return messages.map((msg: any) => ({
      ...msg,
      content: sanitizeData(msg.content),
    }));
  }
  return messages;
}

// 写入日志
function writeLog(entry: any): void {
  const sanitizedEntry = {
    ...entry,
    request: {
      ...entry.request,
      body: entry.request?.body ? {
        ...entry.request.body,
        messages: sanitizeMessages(entry.request.body.messages || []),
      } : entry.request?.body,
    },
    response: {
      ...entry.response,
      body: sanitizeData(entry.response?.body),
    },
  };
  
  const logFile = getLogFilePath();
  const line = JSON.stringify(sanitizedEntry) + '\n';
  fs.appendFileSync(logFile, line);
}

// 清理过期日志
function cleanOldLogs(): void {
  const files = fs.readdirSync(LOG_DIR);
  const now = Date.now();
  const maxAge = LOG_ROTATION_DAYS * 24 * 60 * 60 * 1000;
  
  for (const file of files) {
    if (!file.startsWith('llm-') || !file.endsWith('.jsonl')) continue;
    
    const filePath = path.join(LOG_DIR, file);
    const stat = fs.statSync(filePath);
    
    if (now - stat.mtime.getTime() > maxAge) {
      console.log(`[Proxy] Deleting old log: ${file}`);
      fs.unlinkSync(filePath);
    }
  }
}

// 尝试解析 JSON
function tryParseJson(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

// 解析 SSE 数据
function parseSSEData(data: string): any[] {
  const lines = data.split('\n');
  const chunks: any[] = [];
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const jsonStr = line.slice(6).trim();
      if (jsonStr && jsonStr !== '[DONE]') {
        try {
          chunks.push(JSON.parse(jsonStr));
        } catch {
          // 忽略解析错误
        }
      }
    }
  }
  
  return chunks;
}

// 创建代理实例池
const proxyPool: Record<string, httpProxy> = {};

function getProxy(target: string): httpProxy {
  if (!proxyPool[target]) {
    proxyPool[target] = httpProxy.createProxyServer({
      target,
      changeOrigin: true,
      secure: true,
      agent: getAgent(target),
    });
  }
  
  return proxyPool[target];
}

// 创建服务器
const server = http.createServer((req, res) => {
  // 健康检查端点
  if (req.url === '/health' && req.method === 'GET') {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const routes = loadRoutes();
    const providers = getAllProviders(routes);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: isHealthy ? 'ok' : 'degraded',
      uptime,
      uptimeHuman: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`,
      requestCount,
      errorCount,
      lastRequestTime: lastRequestTime ? new Date(lastRequestTime).toISOString() : null,
      lastHeartbeat: new Date(lastHeartbeat).toISOString(),
      upstreamHealthy: isHealthy,
      providers,
    }));
    return;
  }
  
  // 就绪检查端点
  if (req.url === '/ready' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready: true }));
    return;
  }
  
  // 加载路由配置
  const routes = loadRoutes();
  
  // 匹配路由
  const matched = matchRoute(req.url || '/', routes);
  
  if (!matched) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Route not found',
      path: req.url,
      availableRoutes: Object.keys(routes.routes),
    }));
    return;
  }
  
  const { name: provider, config, targetPath } = matched;
  const target = config.target;
  
  const startTimeThisRequest = Date.now();
  requestCount++;
  lastRequestTime = startTimeThisRequest;
  
  let reqBody: any = null;
  let isStreaming = false;
  const resChunks: Buffer[] = [];
  
  // 收集请求体
  let reqBodyStr = '';
  req.on('data', (chunk) => {
    reqBodyStr += chunk.toString();
  });
  
  req.on('end', () => {
    if (reqBodyStr) {
      try {
        reqBody = JSON.parse(reqBodyStr);
        isStreaming = reqBody.stream === true;
      } catch {
        reqBody = reqBodyStr;
      }
    }
  });

  // 拦截响应
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  
  res.write = function(chunk: any, ...args: any[]): boolean {
    if (chunk) resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return originalWrite(chunk, ...args);
  };
  
  res.end = function(chunk: any, ...args: any[]): any {
    if (chunk) resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    
    const durationMs = Date.now() - startTimeThisRequest;
    const resBodyStr = Buffer.concat(resChunks).toString('utf-8');
    
    if (res.statusCode && res.statusCode >= 400) {
      errorCount++;
    }
    
    try {
      let resBody: any;
      
      if (isStreaming) {
        resBody = {
          type: 'stream',
          chunks: parseSSEData(resBodyStr),
          raw: resBodyStr.length > 10000 ? resBodyStr.slice(0, 10000) + '...(truncated)' : resBodyStr,
        };
      } else {
        resBody = tryParseJson(resBodyStr);
      }
      
      const logEntry = {
        timestamp: startTimeThisRequest,
        provider,
        durationMs,
        isStreaming,
        request: {
          method: req.method,
          path: req.url,
          targetPath,
          target,
          headers: {
            'content-type': req.headers['content-type'],
            'authorization': req.headers['authorization'] ? '(redacted)' : undefined,
          },
          body: reqBody,
        },
        response: {
          statusCode: res.statusCode,
          headers: res.getHeaders ? res.getHeaders() : {},
          body: resBody,
        },
      };
      
      writeLog(logEntry);
      console.log(`[Proxy] ${provider} ${req.method} ${req.url} -> ${target}${targetPath} - ${res.statusCode} (${durationMs}ms)`);
    } catch (e) {
      console.error('[Proxy] Failed to log request:', e);
    }
    
    return originalEnd(chunk, ...args);
  }.bind(res);

  // 获取代理实例
  const proxy = getProxy(target);
  
  // 转发请求（带重试）
  let retryCount = 0;
  
  function forwardRequest() {
    // 修改请求路径
    const originalUrl = req.url;
    req.url = targetPath;
    
    proxy.web(req, res, {
      target,
      changeOrigin: true,
    }, (error) => {
      retryCount++;
      
      // 类型断言：res 是 http.ServerResponse
      const serverRes = res as import('http').ServerResponse;
      
      const shouldRetry = retryCount < MAX_RETRIES && 
                          !serverRes.headersSent &&
                          isRetryableError(error);
      
      if (shouldRetry) {
        console.warn(`[Proxy] Request failed (attempt ${retryCount}/${MAX_RETRIES}), retrying:`, error.message);
        
        setTimeout(() => {
          forwardRequest();
        }, RETRY_DELAY);
      } else {
        errorCount++;
        console.error(`[Proxy] Error after ${retryCount} attempts:`, error.message);
        
        if (!serverRes.headersSent) {
          serverRes.writeHead(502, { 'Content-Type': 'application/json' });
          serverRes.end(JSON.stringify({ 
            error: 'Proxy Error', 
            message: error.message,
            provider,
            retries: retryCount 
          }));
        }
      }
    });
  }
  
  forwardRequest();
});

// 判断是否是可重试的错误
function isRetryableError(error: Error): boolean {
  const retryableMessages = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNREFUSED',
    'socket hang up',
    'network',
    'timeout',
  ];
  
  const message = error.message.toLowerCase();
  return retryableMessages.some(msg => message.includes(msg.toLowerCase()));
}

// 错误处理
function setupProxyErrorHandlers() {
  Object.values(proxyPool).forEach(proxy => {
    proxy.on('error', (err, req, res) => {
      errorCount++;
      console.error('[Proxy] Proxy error:', err.message);
      if (res && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy Error', message: err.message }));
      }
    });
  });
}

// 启动服务器
async function startServer() {
  await ensureLogDir();
  
  // 预加载路由配置
  const routes = loadRoutes();
  const providers = getAllProviders(routes);
  
  // 预创建代理实例
  Object.values(routes.routes).forEach(route => {
    getProxy(route.target);
  });
  
  setupProxyErrorHandlers();
  
  server.listen(PROXY_PORT, () => {
    console.log(`[Proxy] Server started on http://localhost:${PROXY_PORT}`);
    console.log(`[Proxy] Providers: ${providers.join(', ')}`);
    console.log(`[Proxy] Logging to ${LOG_DIR}`);
    console.log(`[Proxy] Health check: http://localhost:${PROXY_PORT}/health`);
    
    cleanOldLogs();
    setInterval(cleanOldLogs, 24 * 60 * 60 * 1000);
    
    // 心跳检测
    setInterval(() => {
      lastHeartbeat = Date.now();
    }, 30000);
  });
}

startServer().catch((error) => {
  console.error('[Proxy] Failed to start server:', error);
  process.exit(1);
});

// 优雅关闭
let isShuttingDown = false;

function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`[Proxy] Received ${signal}, shutting down gracefully...`);
  
  server.close(() => {
    console.log('[Proxy] Server closed');
    process.exit(0);
  });
  
  setTimeout(() => {
    console.error('[Proxy] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
