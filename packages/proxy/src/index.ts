import http from 'http';
import httpProxy from 'http-proxy';
import fs from 'fs';
import path from 'path';

// 配置
const PROXY_PORT = 38080;
const TARGET_BASE_URL = process.env.TARGET_URL || 'https://api.lkeap.cloud.tencent.com/coding/v3';
const LOG_DIR = process.env.LOG_DIR || '/var/log/openclaw-monitor';

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

// 创建代理
const proxy = httpProxy.createProxyServer({
  target: TARGET_BASE_URL,
  changeOrigin: true,
  secure: true,
});

// 创建服务器
const server = http.createServer((req, res) => {
  const startTime = Date.now();
  
  // 收集请求体
  const reqChunks: Buffer[] = [];
  const originalWrite = req.write.bind(req);
  const originalEnd = req.end.bind(req);
  
  // 拦截请求体
  (req as any).write = function(chunk: any, ...args: any[]): any {
    if (chunk) reqChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return originalWrite(chunk, ...args);
  };
  
  (req as any).end = function(chunk: any, ...args: any[]): any {
    if (chunk) reqChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return originalEnd(chunk, ...args);
  };

  // 收集响应体
  const resChunks: Buffer[] = [];
  const originalWriteRes = res.write.bind(res);
  const originalEndRes = res.end.bind(res);
  
  res.write = function(chunk: any, ...args: any[]): boolean {
    if (chunk) resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return originalWriteRes(chunk, ...args);
  };
  
  res.end = function(chunk: any, ...args: any[]): any {
    if (chunk) resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    
    // 记录日志
    const durationMs = Date.now() - startTime;
    const reqBody = Buffer.concat(reqChunks).toString('utf-8');
    const resBody = Buffer.concat(resChunks).toString('utf-8');
    
    try {
      const logEntry = {
        timestamp: startTime,
        durationMs,
        request: {
          method: req.method,
          path: req.url,
          headers: req.headers,
          body: reqBody ? JSON.parse(reqBody) : null,
        },
        response: {
          statusCode: res.statusCode,
          headers: res.getHeaders ? res.getHeaders() : {},
          body: resBody ? tryParseJson(resBody) : null,
        },
      };
      
      writeLog(logEntry);
      console.log(`[Proxy] ${req.method} ${req.url} - ${res.statusCode} (${durationMs}ms)`);
    } catch (e) {
      console.error('[Proxy] Failed to log request:', e);
    }
    
    return originalEndRes(chunk, ...args);
  };

  // 转发请求
  proxy.web(req, res, {
    target: TARGET_BASE_URL,
    changeOrigin: true,
  }, (error) => {
    console.error('[Proxy] Error:', error.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy Error', message: error.message }));
    }
  });
});

// 尝试解析 JSON
function tryParseJson(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

// 错误处理
proxy.on('error', (err, req, res) => {
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
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('[Proxy] Shutting down...');
  server.close(() => {
    console.log('[Proxy] Server closed');
    process.exit(0);
  });
});
