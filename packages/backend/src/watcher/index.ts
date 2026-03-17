import fs from 'fs';
import chokidar from 'chokidar';
import type { CacheTraceEntry, Run, DBCacheTrace } from '../types';
import { convertToRun, parseRecentEntries, parseCacheTraceIncremental } from '../parser';
import * as db from '../db';

// ==================== ✅ 性能优化：O(1) LRU 缓存 ====================

/**
 * ✅ 优化：O(1) LRU 缓存（双向链表 + Map）
 * - get/set 都是 O(1)
 * - 淘汰尾部节点 O(1)
 */
class LRUCache<K, V> {
  private cache = new Map<K, ListNode<K, V>>();
  private head: ListNode<K, V> | null = null;  // 最新访问
  private tail: ListNode<K, V> | null = null;  // 最少访问（淘汰目标）
  private maxSize: number;
  
  constructor(maxSize: number = 5000) {
    this.maxSize = maxSize;
  }
  
  get(key: K): V | null {
    const node = this.cache.get(key);
    if (!node) return null;
    
    // 移动到头部（最近访问）
    this.moveToHead(node);
    return node.value;
  }
  
  set(key: K, value: V): void {
    const existing = this.cache.get(key);
    
    if (existing) {
      // 更新值并移动到头部
      existing.value = value;
      this.moveToHead(existing);
    } else {
      // 创建新节点
      const node: ListNode<K, V> = { key, value, prev: null, next: null };
      
      // 缓存已满，淘汰尾部
      if (this.cache.size >= this.maxSize && this.tail) {
        this.cache.delete(this.tail.key);
        this.removeNode(this.tail);
      }
      
      // 添加到头部
      this.cache.set(key, node);
      this.addToHead(node);
    }
  }
  
  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }
  
  size(): number {
    return this.cache.size;
  }
  
  private moveToHead(node: ListNode<K, V>): void {
    this.removeNode(node);
    this.addToHead(node);
  }
  
  private addToHead(node: ListNode<K, V>): void {
    node.prev = null;
    node.next = this.head;
    
    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;
    
    if (!this.tail) {
      this.tail = node;
    }
  }
  
  private removeNode(node: ListNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }
    
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }
}

interface ListNode<K, V> {
  key: K;
  value: V;
  prev: ListNode<K, V> | null;
  next: ListNode<K, V> | null;
}

// 全局解析缓存（使用 O(1) LRU）
const parseCache = new LRUCache<string, CacheTraceEntry>(5000);

/**
 * 带缓存的 JSON 解析
 */
function parseCached(raw: string): CacheTraceEntry | null {
  // 先查缓存
  const cached = parseCache.get(raw);
  if (cached) {
    return cached;
  }
  
  // 解析并缓存
  try {
    const entry = JSON.parse(raw) as CacheTraceEntry;
    parseCache.set(raw, entry);
    return entry;
  } catch (e) {
    return null;
  }
}

// ==================== Watcher 实现 ====================

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
  
  // 重置状态
  isWatcherClosed = false;
  isProcessing = false;
  
  // 设置回调
  onNewRun = options.onNewRun || null;
  onRunUpdate = options.onRunUpdate || null;
  
  // 从数据库恢复上次位置（崩溃恢复）
  lastPosition = db.getFilePosition(filePath);
  console.log(`[Watcher] Starting from position: ${lastPosition}`);
  
  watcher = chokidar.watch(filePath, {
    persistent: true,
    ignoreInitial: true,  // 忽略初始事件，避免重复处理
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });
  
  // 文件变更
  watcher.on('change', async () => {
    await handleFileChange(filePath);
  });
  
  // 文件删除
  watcher.on('unlink', () => {
    console.log(`[Watcher] File deleted: ${filePath}`);
    lastPosition = 0;
    db.setFilePosition(filePath, 0);
    parseCache.clear();
  });
  
  // 错误处理
  watcher.on('error', (error) => {
    console.error(`[Watcher] Error:`, error);
    setTimeout(() => {
      if (!isWatcherClosed && watcher) {
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
  if (isProcessing) {
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
      console.log(`[Watcher] File truncated, resetting position: ${lastPosition} -> 0`);
      lastPosition = 0;
      db.setFilePosition(filePath, 0);
      parseCache.clear();
    }
  } catch (e) {
    console.error(`[Watcher] Error handling file change:`, e);
    
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      lastPosition = 0;
      db.setFilePosition(filePath, 0);
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * ✅ 优化：处理新增行（分批读取，避免大块内存分配）
 */
async function processNewLines(
  filePath: string,
  start: number,
  end: number
): Promise<void> {
  const totalSize = end - start;
  
  // ✅ 如果数据量小于 256KB，直接读取
  if (totalSize <= 256 * 1024) {
    await processNewLinesSmall(filePath, start, end);
    return;
  }
  
  // ✅ 数据量大时分批读取
  const CHUNK_SIZE = 256 * 1024;  // 256KB 每批
  let position = start;
  let carryBuffer = '';
  
  const fd = await fs.promises.open(filePath, 'r');
  
  try {
    const runEntries = new Map<string, CacheTraceEntry[]>();
    const cacheTraces: DBCacheTrace[] = [];
    
    while (position < end) {
      const readSize = Math.min(CHUNK_SIZE, end - position);
      const chunk = Buffer.alloc(readSize);
      await fd.read(chunk, 0, readSize, position);
      
      const content = carryBuffer + chunk.toString('utf-8');
      const lines = content.split('\n');
      
      // 第一个元素可能不完整，保存到下次处理
      carryBuffer = lines.shift() || '';
      
      // 处理完整的行
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const entry = parseCached(line);
        if (!entry) continue;
        
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
      }
      
      position += readSize;
    }
    
    // 处理最后的 carry buffer
    if (carryBuffer.trim()) {
      const entry = parseCached(carryBuffer);
      if (entry) {
        cacheTraces.push({
          runId: entry.runId,
          sessionId: entry.sessionId,
          sessionKey: entry.sessionKey,
          provider: entry.provider,
          modelId: entry.modelId,
          stage: entry.stage,
          seq: entry.seq,
          timestamp: new Date(entry.ts).getTime(),
          raw: carryBuffer,
          createdAt: Date.now(),
        });
        
        if (!runEntries.has(entry.runId)) {
          runEntries.set(entry.runId, []);
        }
        runEntries.get(entry.runId)!.push(entry);
      }
    }
    
    // 批量保存
    if (cacheTraces.length > 0) {
      db.saveCacheTracesBatch(cacheTraces);
    }
    
    for (const [runId, entries] of runEntries) {
      await processRunEntries(runId, entries);
    }
  } finally {
    await fd.close().catch(e => console.error('[Watcher] Failed to close fd:', e));
  }
}

/**
 * 处理小量新增数据（< 256KB）
 */
async function processNewLinesSmall(
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
    
    const runEntries = new Map<string, CacheTraceEntry[]>();
    const cacheTraces: DBCacheTrace[] = [];
    
    for (const line of lines) {
      const entry = parseCached(line);
      if (!entry) continue;
      
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
    }
    
    if (cacheTraces.length > 0) {
      db.saveCacheTracesBatch(cacheTraces);
    }
    
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
 * ✅ 优化：处理 Run 条目（使用缓存解析）
 */
async function processRunEntries(
  runId: string, 
  newEntries: CacheTraceEntry[]
): Promise<void> {
  db.transaction(() => {
    // 获取已有的条目
    const existingTraces = db.getCacheTracesByRunId(runId);
    
    // 合并条目
    const allEntries: CacheTraceEntry[] = [];
    const seenSeq = new Set<number>();
    
    // ✅ 使用缓存解析
    for (const trace of existingTraces) {
      const entry = parseCached(trace.raw);
      if (entry && !seenSeq.has(entry.seq)) {
        allEntries.push(entry);
        seenSeq.add(entry.seq);
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
    
    // 在事务外触发回调
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
  isWatcherClosed = true;
  
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  
  // 清理回调引用
  onNewRun = null;
  onRunUpdate = null;
  isProcessing = false;
  
  // 清理解析缓存
  parseCache.clear();
}

/**
 * 增量初始化
 */
export async function initializeIncremental(
  filePath: string,
  options: {
    recentLimit?: number;
    forceFull?: boolean;
  } = {}
): Promise<{ 
  runsProcessed: number; 
  startPosition: number;
  fromCache: boolean;
}> {
  const { recentLimit = 100, forceFull = false } = options;
  
  const savedPosition = db.getFilePosition(filePath);
  
  let fileSize = 0;
  try {
    const stat = await fs.promises.stat(filePath);
    fileSize = stat.size;
  } catch (e) {
    console.warn('[Watcher] File not found:', filePath);
    return { runsProcessed: 0, startPosition: 0, fromCache: false };
  }
  
  // 有保存的位置，从该位置继续
  if (savedPosition > 0 && savedPosition < fileSize && !forceFull) {
    console.log(`[Watcher] Resuming from saved position: ${savedPosition}`);
    
    const { entries, endPosition } = await parseCacheTraceIncremental(
      filePath, 
      savedPosition,
      { limit: 1000 }
    );
    
    if (entries.length > 0) {
      const runEntries = new Map<string, CacheTraceEntry[]>();
      const cacheTraces: DBCacheTrace[] = [];
      
      for (const entry of entries) {
        cacheTraces.push({
          runId: entry.runId,
          sessionId: entry.sessionId,
          sessionKey: entry.sessionKey,
          provider: entry.provider,
          modelId: entry.modelId,
          stage: entry.stage,
          seq: entry.seq,
          timestamp: new Date(entry.ts).getTime(),
          raw: JSON.stringify(entry),
          createdAt: Date.now(),
        });
        
        if (!runEntries.has(entry.runId)) {
          runEntries.set(entry.runId, []);
        }
        runEntries.get(entry.runId)!.push(entry);
      }
      
      if (cacheTraces.length > 0) {
        db.saveCacheTracesBatch(cacheTraces);
      }
      
      for (const [runId, runEntryList] of runEntries) {
        await processRunEntries(runId, runEntryList);
      }
      
      lastPosition = endPosition;
      db.setFilePosition(filePath, endPosition);
    } else {
      lastPosition = fileSize;
      db.setFilePosition(filePath, fileSize);
    }
    
    return { 
      runsProcessed: entries.length, 
      startPosition: savedPosition,
      fromCache: true 
    };
  }
  
  // 首次启动：只解析最近的记录
  console.log(`[Watcher] First run, parsing recent ${recentLimit} entries`);
  
  const entries = await parseRecentEntries(filePath, recentLimit);
  
  if (entries.length > 0) {
    const runEntries = new Map<string, CacheTraceEntry[]>();
    const cacheTraces: DBCacheTrace[] = [];
    
    for (const entry of entries) {
      cacheTraces.push({
        runId: entry.runId,
        sessionId: entry.sessionId,
        sessionKey: entry.sessionKey,
        provider: entry.provider,
        modelId: entry.modelId,
        stage: entry.stage,
        seq: entry.seq,
        timestamp: new Date(entry.ts).getTime(),
        raw: JSON.stringify(entry),
        createdAt: Date.now(),
      });
      
      if (!runEntries.has(entry.runId)) {
        runEntries.set(entry.runId, []);
      }
      runEntries.get(entry.runId)!.push(entry);
    }
    
    if (cacheTraces.length > 0) {
      db.saveCacheTracesBatch(cacheTraces);
    }
    
    for (const [runId, runEntryList] of runEntries) {
      await processRunEntries(runId, runEntryList);
    }
  }
  
  lastPosition = fileSize;
  db.setFilePosition(filePath, fileSize);
  
  return { 
    runsProcessed: entries.length, 
    startPosition: 0,
    fromCache: false 
  };
}

/**
 * 全量重新解析
 */
export async function reparseAll(
  filePath: string,
  options: {
    batchSize?: number;
    onProgress?: (processed: number, total: number) => void;
  } = {}
): Promise<{ totalProcessed: number }> {
  console.warn('[Watcher] Starting full reparse (use with caution on large files)');
  
  const { batchSize = 1000, onProgress } = options;
  
  const stat = await fs.promises.stat(filePath);
  const fileSize = stat.size;
  
  let position = 0;
  let totalProcessed = 0;
  
  while (position < fileSize) {
    const { entries, endPosition } = await parseCacheTraceIncremental(
      filePath, 
      position, 
      { limit: batchSize }
    );
    
    if (entries.length === 0) break;
    
    const runEntries = new Map<string, CacheTraceEntry[]>();
    const cacheTraces: DBCacheTrace[] = [];
    
    for (const entry of entries) {
      cacheTraces.push({
        runId: entry.runId,
        sessionId: entry.sessionId,
        sessionKey: entry.sessionKey,
        provider: entry.provider,
        modelId: entry.modelId,
        stage: entry.stage,
        seq: entry.seq,
        timestamp: new Date(entry.ts).getTime(),
        raw: JSON.stringify(entry),
        createdAt: Date.now(),
      });
      
      if (!runEntries.has(entry.runId)) {
        runEntries.set(entry.runId, []);
      }
      runEntries.get(entry.runId)!.push(entry);
    }
    
    if (cacheTraces.length > 0) {
      db.saveCacheTracesBatch(cacheTraces);
    }
    
    for (const [runId, runEntryList] of runEntries) {
      await processRunEntries(runId, runEntryList);
    }
    
    totalProcessed += entries.length;
    position = endPosition;
    
    lastPosition = endPosition;
    db.setFilePosition(filePath, endPosition);
    
    if (onProgress) {
      onProgress(totalProcessed, fileSize);
    }
    
    console.log(`[Watcher] Reparsed ${totalProcessed} entries, position: ${position}/${fileSize}`);
  }
  
  return { totalProcessed };
}

/**
 * 获取当前监听状态
 */
export function getWatcherStatus(): {
  isRunning: boolean;
  lastPosition: number;
  isProcessing: boolean;
  parseCacheSize: number;
} {
  return {
    isRunning: watcher !== null && !isWatcherClosed,
    lastPosition,
    isProcessing,
    parseCacheSize: parseCache.size(),
  };
}
