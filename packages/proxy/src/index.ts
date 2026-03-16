import http from 'http';
import httpProxy from 'http-proxy';
import fs from 'fs';
import path from 'path';

// 配置
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '38080');
const TARGET_BASE_URL = process.env.TARGET_URL || 'https://api.lkeap.cloud.tencent.com/coding/v3';
const LOG_DIR = process.env.LOG_DIR || '/var/log/openclaw-monitor';
const LOG_ROTATION_DAYS = parseInt(process.env.LOG_ROTATION_DAYS || '7');
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3');
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY || '1000');

// 状态
const startTime = Date.now();
let requestCount = 0;
let errorCount = 0;
let lastRequestTime: number | null = null;
let lastHeartbeat: number = Date.now();
let isHealthy = true;

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 获取日志文件路径
function getLogFilePath(): string {
  const date = new Date().toISOString().split('T')[0];
  return path.join(LOG_DIR, `llm-${date}.jsonl`);
}

// 写入日志
function writeLog(entry: any): void {
  const logFile = getLogFilePath();
  const line = JSON.stringify(entry) + '\n';
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

// 创建代理
const proxy = httpProxy.createProxyServer({
  target: TARGET_BASE_URL,
  changeOrigin: true,
  secure: true,
});

// 创建服务器
const server = http.createServer((req, res) => {
  // 健康检查端点
  if (req.url === '/health' && req.method === 'GET') {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
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
      target: TARGET_BASE_URL,
    }));
    return;
  }
  
  // 就绪检查端点
  if (req.url === '/ready' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready: true }));
    return;
  }
  
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
    
    // 记录日志
    const durationMs = Date.now() - startTimeThisRequest;
    const resBodyStr = Buffer.concat(resChunks).toString('utf-8');
    
    // 统计错误
    if (res.statusCode && res.statusCode >= 400) {
      errorCount++;
    }
    
    try {
      let resBody: any;
      
      if (isStreaming) {
        // 流式响应：解析 SSE 数据
        resBody = {
          type: 'stream',
          chunks: parseSSEData(resBodyStr),
          raw: resBodyStr.length > 10000 ? resBodyStr.slice(0, 10000) + '...(truncated)' : resBodyStr,
        };
      } else {
        // 非流式响应
        resBody = tryParseJson(resBodyStr);
      }
      
      const logEntry = {
        timestamp: startTimeThisRequest,
        durationMs,
        isStreaming,
        request: {
          method: req.method,
          path: req.url,
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
      console.log(`[Proxy] ${req.method} ${req.url} - ${res.statusCode} (${durationMs}ms, ${isStreaming ? 'streaming' : 'non-streaming'})`);
    } catch (e) {
      console.error('[Proxy] Failed to log request:', e);
    }
    
    return originalEnd(chunk, ...args);
  }.bind(res);

  // 转发请求
  proxy.web(req, res, {
    target: TARGET_BASE_URL,
    changeOrigin: true,
  }, (error) => {
    errorCount++;
    console.error('[Proxy] Error:', error.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy Error', message: error.message }));
    }
  });
});

// 错误处理
proxy.on('error', (err, req, res) => {
  errorCount++;
  console.error('[Proxy] Proxy error:', err.message);
  if (res && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy Error', message: err.message }));
  }
});

// 启动服务器
server.listen(PROXY_PORT, () => {
  console.log(`[Proxy] Server started on http://localhost:${PROXY_PORT}`);
  console.log(`[Proxy] Forwarding to ${TARGET_BASE_URL}`);
  console.log(`[Proxy] Logging to ${LOG_DIR}`);
  console.log(`[Proxy] Health check: http://localhost:${PROXY_PORT}/health`);
  
  // 启动时清理旧日志
  cleanOldLogs();
  
  // 每天清理一次旧日志
  setInterval(cleanOldLogs, 24 * 60 * 60 * 1000);
  
  // 心跳检测（每30秒）
  setInterval(() => {
    lastHeartbeat = Date.now();
    
    // 检查上游 API 是否可达
    const req = http.request(TARGET_BASE_URL + '/models', {
      method: 'HEAD',
      timeout: 5000,
    }, (res) => {
      isHealthy = res.statusCode !== undefined && res.statusCode < 500;
    });
    
    req.on('error', (err) => {
      isHealthy = false;
      console.error('[Proxy] Upstream health check failed:', err.message);
    });
    
    req.on('timeout', () => {
      isHealthy = false;
      req.destroy();
      console.error('[Proxy] Upstream health check timeout');
    });
    
    req.end();
  }, 30000);
});

// 优雅关闭
let isShuttingDown = false;

function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`[Proxy] Received ${signal}, shutting down gracefully...`);
  
  // 停止接受新连接
  server.close(() => {
    console.log('[Proxy] Server closed');
    process.exit(0);
  });
  
  // 强制退出超时
  setTimeout(() => {
    console.error('[Proxy] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
