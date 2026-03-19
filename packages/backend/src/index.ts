import { serve } from '@hono/node-server';
import { createApp } from './routes';
import { initDB, closeDB, cleanupOldCacheTraces, cleanupOldRuns, vacuumDatabase, getStats } from './db';
import { startWatcher, stopWatcher, initializeIncremental, getWatcherStatus, startMessageWatcher, stopMessageWatcher } from './watcher';
import { broadcast, startPeriodicCleanup, stopPeriodicCleanup, getConnectionCount } from './ws';
import type { Run } from './types';
import path from 'path';
import fs from 'fs';

// 配置
const config = {
  openclawDir: process.env.OPENCLAW_DIR || '/root/.openclaw',
  cacheTracePath: process.env.CACHE_TRACE_PATH || path.join(process.env.HOME || '/root', '.openclaw/logs/cache-trace.jsonl'),
  sessionsPath: process.env.SESSIONS_PATH || path.join(process.env.HOME || '/root', '.openclaw/sessions'),
  dbPath: process.env.DB_PATH || '/var/lib/openclaw-monitor/monitor.db',
  port: parseInt(process.env.PORT || '3000'),
  recentLimit: parseInt(process.env.RECENT_LIMIT || '100'),
  // ✅ 新增：清理配置
  cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL || '3600000'), // 1小时
  cacheTracesDaysToKeep: parseInt(process.env.CACHE_TRACES_DAYS || '7'),
  runsDaysToKeep: parseInt(process.env.RUNS_DAYS || '30'),
};

console.log('[Monitor] Starting with config:', {
  ...config,
  cacheTracePath: config.cacheTracePath,
});

// 确保数据库目录存在
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log(`[Monitor] Created database directory: ${dbDir}`);
}

// 初始化数据库
initDB(config.dbPath);
console.log(`[Monitor] Database initialized: ${config.dbPath}`);

// 创建应用
const { app, runCache } = createApp();

// 启动服务
const server = serve({
  fetch: app.fetch,
  port: config.port,
});

console.log(`[Monitor] Server started on http://localhost:${config.port}`);

// ✅ 启动 WebSocket 定期清理
startPeriodicCleanup(60000);

// ✅ 启动数据库定期清理
let dbCleanupTimer: NodeJS.Timeout | null = null;

function startDatabaseCleanup(): void {
  dbCleanupTimer = setInterval(() => {
    console.log('[Monitor] Running database cleanup...');
    
    const cleanedTraces = cleanupOldCacheTraces(config.cacheTracesDaysToKeep);
    const cleanedRuns = cleanupOldRuns(config.runsDaysToKeep);
    
    // 如果清理了大量数据，执行 VACUUM
    if (cleanedTraces > 1000 || cleanedRuns > 100) {
      vacuumDatabase();
    }
    
    // 打印统计信息
    const stats = getStats();
    console.log(`[Monitor] DB Stats: ${stats.runsCount} runs, ${stats.dbSizeMB}MB`);
  }, config.cleanupInterval);
  
  console.log(`[Monitor] Database cleanup started, interval: ${config.cleanupInterval}ms`);
}

function stopDatabaseCleanup(): void {
  if (dbCleanupTimer) {
    clearInterval(dbCleanupTimer);
    dbCleanupTimer = null;
  }
}

// ✅ 立即启动文件监听（不等待初始化）
startWatcher(config.cacheTracePath, {
  onNewRun: (run: Run) => {
    console.log(`[Monitor] New run: ${run.id}`);
    runCache.addRun(run);
    broadcast('run:started', run);
  },
  onRunUpdate: (run: Run) => {
    console.log(`[Monitor] Run updated: ${run.id}`);
    runCache.addRun(run);
    broadcast('run:completed', run);
  },
});

// ✅ 立即启动消息文件监听
startMessageWatcher(config.sessionsPath, {
  onNewMessage: (data) => {
    console.log(`[Monitor] New message: ${data.type}`);
    broadcast('chat:updated' as any, data as any);
  },
});

const status = getWatcherStatus();
console.log(`[Monitor] Watching: ${config.cacheTracePath}, position: ${status.lastPosition}`);

// 启动数据库清理
startDatabaseCleanup();

// ✅ 后台增量初始化（不阻塞服务启动）
initializeIncremental(config.cacheTracePath, { recentLimit: config.recentLimit })
  .then((result) => {
    console.log(`[Monitor] Incremental init completed: ${result.runsProcessed} runs, from cache: ${result.fromCache}`);
    
    // 打印初始统计
    const stats = getStats();
    console.log(`[Monitor] Initial stats: ${stats.runsCount} runs, ${stats.dbSizeMB}MB`);
  })
  .catch(e => {
    console.error('[Monitor] Initialization failed:', e);
  });

// 优雅关闭
async function shutdown(signal: string) {
  console.log(`\n[Monitor] Received ${signal}, shutting down...`);
  
  // 1. 停止接收新请求
  server.close(() => {
    console.log('[Monitor] HTTP server closed');
  });
  
  // 2. 停止文件监听
  stopWatcher();
  stopMessageWatcher();
  console.log('[Monitor] Watcher stopped');
  
  // 3. 停止定期清理
  stopPeriodicCleanup();
  stopDatabaseCleanup();
  console.log('[Monitor] Periodic cleanup stopped');
  
  // 4. 关闭数据库
  closeDB();
  console.log('[Monitor] Database closed');
  
  // 5. 退出
  console.log('[Monitor] Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ✅ 未捕获异常处理
process.on('uncaughtException', (error) => {
  console.error('[Monitor] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Monitor] Unhandled rejection at:', promise, 'reason:', reason);
});

export { app };
