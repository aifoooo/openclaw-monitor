import { serve } from '@hono/node-server';
import { createApp } from './routes';
import { initDB, closeDB, getNextSeq, saveWSMessage } from './db';
import { startWatcher, stopWatcher, reparseAll } from './watcher';
import { broadcast } from './ws';
import type { Run } from './types';
import path from 'path';
import fs from 'fs';

// 配置
const config = {
  openclawDir: process.env.OPENCLAW_DIR || '/root/.openclaw',
  cacheTracePath: process.env.CACHE_TRACE_PATH || path.join(process.env.HOME || '/root', '.openclaw/logs/cache-trace.jsonl'),
  dbPath: process.env.DB_PATH || '/var/lib/openclaw-monitor/monitor.db',
  port: parseInt(process.env.PORT || '3000'),
};

// 确保数据库目录存在
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// 初始化数据库
initDB(config.dbPath);
console.log(`[Monitor] Database initialized: ${config.dbPath}`);

// 创建应用
const { app } = createApp();

// 启动服务
const server = serve({
  fetch: app.fetch,
  port: config.port,
});

console.log(`[Monitor] Server started on http://localhost:${config.port}`);

// 启动文件监听
startWatcher(config.cacheTracePath, {
  onNewRun: (run: Run) => {
    console.log(`[Monitor] New run: ${run.id}`);
    broadcast('run:started', run);
  },
  onRunUpdate: (run: Run) => {
    console.log(`[Monitor] Run updated: ${run.id}`);
    broadcast('run:completed', run);
  },
});

console.log(`[Monitor] Watching: ${config.cacheTracePath}`);

// 初始全量解析
reparseAll(config.cacheTracePath)
  .then(() => console.log('[Monitor] Initial parse completed'))
  .catch(e => console.error('[Monitor] Initial parse failed:', e));

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n[Monitor] Shutting down...');
  stopWatcher();
  closeDB();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Monitor] Shutting down...');
  stopWatcher();
  closeDB();
  server.close();
  process.exit(0);
});

export { app };
