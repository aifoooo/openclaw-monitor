import fs from 'fs';
import chokidar from 'chokidar';
import type { CacheTraceEntry, Run, DBCacheTrace } from '../types';
import { convertToRun } from '../parser';
import * as db from '../db';

// 全局状态
let watcher: chokidar.FSWatcher | null = null;
let onNewRun: ((run: Run) => void) | null = null;
let onRunUpdate: ((run: Run) => void) | null = null;
let isProcessing = false;  // 并发锁
let lastPosition = 0;      // 文件位置
let isWatcherClosed = false;  // watcher 状态

/**
 * 启动文件监听
 */
export function startWatcher(
  filePath: string,
  options: {
    onNewRun?: (run: Run) => void;
    onRunUpdate?: (run: Run) => void;
  } = {}
): chokidar.FSWatcher {
  // 防止重复创建
  if (watcher) {
    console.warn('[Watcher] Already running, stopping old watcher');
    stopWatcher();
  }
  
  // 设置回调
  onNewRun = options.onNewRun || null;
  onRunUpdate = options.onRunUpdate || null;
  
  // 从数据库恢复上次位置（崩溃恢复）
  lastPosition = db.getFilePosition(filePath);
  console.log(`[Watcher] Starting from position: ${lastPosition}`);
  
  watcher = chokidar.watch(filePath, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });
  
  // 初始读取
  watcher.on('add', async () => {
    console.log(`[Watcher] File added: ${filePath}`);
    await handleFileChange(filePath);
  });
  
  // 文件变更
  watcher.on('change', async () => {
    await handleFileChange(filePath);
  });
  
  // 文件删除
  watcher.on('unlink', () => {
    console.log(`[Watcher] File deleted: ${filePath}`);
    // 重置位置，等待文件重建
    lastPosition = 0;
    db.setFilePosition(filePath, 0);
  });
  
  // 错误处理
  watcher.on('error', (error) => {
    console.error(`[Watcher] Error:`, error);
    // 尝试重新监听
    setTimeout(() => {
      if (watcher && !isWatcherClosed) {
        console.log('[Watcher] Attempting to re-add file');
        watcher.add(filePath);
      }
    }, 1000);
  });
  
  return watcher;
}

/**
 * 处理文件变更（带并发锁）
 */
async function handleFileChange(filePath: string): Promise<void> {
  // 并发锁：避免同时处理多个变更事件
  if (isProcessing) {
    console.log('[Watcher] Already processing, skipping');
    return;
  }
  
  isProcessing = true;
  
  try {
    const stat = await fs.promises.stat(filePath);
    
    if (stat.size > lastPosition) {
      await processNewLines(filePath, lastPosition, stat.size);
      lastPosition = stat.size;
      db.setFilePosition(filePath, lastPosition);
    } else if (stat.size < lastPosition) {
      // 文件被截断（可能被清理了）
      console.log(`[Watcher] File truncated, resetting position: ${lastPosition} -> 0`);
      lastPosition = 0;
      db.setFilePosition(filePath, 0);
    }
  } catch (e) {
    console.error(`[Watcher] Error handling file change:`, e);
    
    // 如果文件不存在，重置位置
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      lastPosition = 0;
      db.setFilePosition(filePath, 0);
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * 处理新增行
 */
async function processNewLines(
  filePath: string,
  start: number,
  end: number
): Promise<void> {
  let fd: fs.promises.FileHandle | null = null;
  
  try {
    fd = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(end - start);
    await fd.read(buffer, 0, buffer.length, start);
    
    const lines = buffer.toString().split('\n').filter(l => l.trim());
    
    if (lines.length === 0) return;
    
    // 按 runId 分组
    const runEntries = new Map<string, CacheTraceEntry[]>();
    const cacheTraces: DBCacheTrace[] = [];
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as CacheTraceEntry;
        
        // 准备批量保存
        cacheTraces.push({
          runId: entry.runId,
          sessionId: entry.sessionId,
          sessionKey: entry.sessionKey,
          provider: entry.provider,
          modelId: entry.modelId,
          stage: entry.stage,
          seq: entry.seq,
          timestamp: new Date(entry.ts).getTime(),
          raw: line,
          createdAt: Date.now(),
        });
        
        if (!runEntries.has(entry.runId)) {
          runEntries.set(entry.runId, []);
        }
        runEntries.get(entry.runId)!.push(entry);
      } catch (e) {
        console.error(`[Watcher] Failed to parse line:`, e);
      }
    }
    
    // 批量保存原始数据（事务）
    if (cacheTraces.length > 0) {
      db.saveCacheTracesBatch(cacheTraces);
    }
    
    // 处理每个 runId
    for (const [runId, entries] of runEntries) {
      await processRunEntries(runId, entries);
    }
  } finally {
    if (fd) {
      await fd.close().catch(e => console.error('[Watcher] Failed to close fd:', e));
    }
  }
}

/**
 * 处理 Run 条目
 */
async function processRunEntries(
  runId: string, 
  newEntries: CacheTraceEntry[]
): Promise<void> {
  // 使用事务处理
  db.transaction(() => {
    // 获取已有的条目
    const existingTraces = db.getCacheTracesByRunId(runId);
    
    // 合并条目
    const allEntries: CacheTraceEntry[] = [];
    const seenSeq = new Set<number>();
    
    for (const trace of existingTraces) {
      try {
        const entry: CacheTraceEntry = JSON.parse(trace.raw);
        if (!seenSeq.has(entry.seq)) {
          allEntries.push(entry);
          seenSeq.add(entry.seq);
        }
      } catch (e) {
        console.error('[Watcher] Failed to parse trace:', e);
      }
    }
    
    for (const entry of newEntries) {
      if (!seenSeq.has(entry.seq)) {
        allEntries.push(entry);
        seenSeq.add(entry.seq);
      }
    }
    
    // 按 seq 排序
    allEntries.sort((a, b) => a.seq - b.seq);
    
    // 转换为 Run
    const run = convertToRun(allEntries);
    if (!run) return;
    
    // 检查是新 Run 还是更新
    const existingRun = db.getRunById(runId);
    
    // 保存到数据库
    db.saveRun(run);
    
    // 在事务外触发回调（避免事务嵌套）
    process.nextTick(() => {
      if (!existingRun && onNewRun) {
        onNewRun(run);
      } else if (existingRun && onRunUpdate) {
        onRunUpdate(run);
      }
    });
  });
}

/**
 * 停止监听
 */
export function stopWatcher(): void {
  if (watcher) {
    isWatcherClosed = true;
    watcher.close();
    watcher = null;
  }
  
  // 清理回调引用（防止内存泄漏）
  onNewRun = null;
  onRunUpdate = null;
  isProcessing = false;
}

/**
 * 全量重新解析
 */
export async function reparseAll(filePath: string): Promise<void> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  
  // 按 runId 分组
  const runEntries = new Map<string, CacheTraceEntry[]>();
  const cacheTraces: DBCacheTrace[] = [];
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    try {
      const entry = JSON.parse(line) as CacheTraceEntry;
      
      cacheTraces.push({
        runId: entry.runId,
        sessionId: entry.sessionId,
        sessionKey: entry.sessionKey,
        provider: entry.provider,
        modelId: entry.modelId,
        stage: entry.stage,
        seq: entry.seq,
        timestamp: new Date(entry.ts).getTime(),
        raw: line,
        createdAt: Date.now(),
      });
      
      if (!runEntries.has(entry.runId)) {
        runEntries.set(entry.runId, []);
      }
      runEntries.get(entry.runId)!.push(entry);
    } catch (e) {
      console.error(`[Watcher] Failed to parse line:`, e);
    }
  }
  
  // 批量保存原始数据（事务）
  if (cacheTraces.length > 0) {
    db.saveCacheTracesBatch(cacheTraces);
  }
  
  // 处理每个 runId
  for (const [runId, entries] of runEntries) {
    await processRunEntries(runId, entries);
  }
  
  // 更新文件位置
  const newPosition = Buffer.byteLength(content, 'utf-8');
  lastPosition = newPosition;
  db.setFilePosition(filePath, newPosition);
}

/**
 * 获取当前监听状态
 */
export function getWatcherStatus(): {
  isRunning: boolean;
  lastPosition: number;
  isProcessing: boolean;
} {
  return {
    isRunning: watcher !== null && !isWatcherClosed,
    lastPosition,
    isProcessing,
  };
}
