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
  const startTime = Date.now();
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
    const durationMs = Date.now() - startTime;
    const resBodyStr = Buffer.concat(resChunks).toString('utf-8');
    
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
        timestamp: startTime,
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
    
    return originalEndRes(chunk, ...args);
  }.bind(res);

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
