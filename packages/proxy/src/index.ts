import http from 'http';
import httpProxy from 'http-proxy';
import { URL } from 'url';

// 配置
const PROXY_PORT = 38080;
const TARGET_BASE_URL = process.env.TARGET_URL || 'https://api.lkeap.cloud.tencent.com/coding/v3';

// 创建代理
const proxy = httpProxy.createProxyServer({
  target: TARGET_BASE_URL,
  changeOrigin: true,
  secure: true,
});

// 创建服务器
const server = http.createServer((req, res) => {
  console.log(`[Proxy] ${req.method} ${req.url}`);

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
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('[Proxy] Shutting down...');
  server.close(() => {
    console.log('[Proxy] Server closed');
    process.exit(0);
  });
});
