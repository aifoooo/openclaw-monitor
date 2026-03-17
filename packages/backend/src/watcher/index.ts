import fs from 'fs';
import chokidar from 'chokidar';
import type { CacheTraceEntry, Run } from '../types';
import { convertToRun } from '../parser';
import * as db from '../db';

let watcher: chokidar.FSWatcher | null = null;
let onNewRun: ((run: Run) => void) | null = null;
let onRunUpdate: ((run: Run) => void) | null = null;

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
  onNewRun = options.onNewRun || null;
  onRunUpdate = options.onRunUpdate || null;
  
  // 获取上次读取的位置
  let lastPosition = db.getFilePosition(filePath);
  
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
    
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > lastPosition) {
        await processNewLines(filePath, lastPosition, stat.size);
        lastPosition = stat.size;
        db.setFilePosition(filePath, lastPosition);
      }
    } catch (e) {
      console.error(`[Watcher] Error on add:`, e);
    }
  });
  
  // 文件变更
  watcher.on('change', async () => {
    try {
      const stat = await fs.promises.stat(filePath);
      
      if (stat.size > lastPosition) {
        await processNewLines(filePath, lastPosition, stat.size);
        lastPosition = stat.size;
        db.setFilePosition(filePath, lastPosition);
      }
    } catch (e) {
      console.error(`[Watcher] Error on change:`, e);
    }
  });
  
  watcher.on('error', (error) => {
    console.error(`[Watcher] Error:`, error);
  });
  
  return watcher;
}

/**
 * 处理新增行
 */
async function processNewLines(
  filePath: string,
  start: number,
  end: number
): Promise<void> {
  const fd = await fs.promises.open(filePath, 'r');
  const buffer = Buffer.alloc(end - start);
  await fd.read(buffer, 0, buffer.length, start);
  await fd.close();
  
  const lines = buffer.toString().split('\n').filter(l => l.trim());
  
  if (lines.length === 0) return;
  
  // 按 runId 分组
  const runEntries = new Map<string, CacheTraceEntry[]>();
  
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as CacheTraceEntry;
      
      // 保存原始数据
      db.saveCacheTrace({
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
  
  // 处理每个 runId
  for (const [runId, entries] of runEntries) {
    await processRunEntries(runId, entries);
  }
}

/**
 * 处理 Run 条目
 */
async function processRunEntries(
  runId: string, 
  newEntries: CacheTraceEntry[]
): Promise<void> {
  // 获取已有的条目
  const existingTraces = db.getCacheTracesByRunId(runId);
  
  // 合并条目
  const allEntries: CacheTraceEntry[] = [];
  const seenSeq = new Set<number>();
  
  for (const trace of existingTraces) {
    const entry: CacheTraceEntry = JSON.parse(trace.raw);
    if (!seenSeq.has(entry.seq)) {
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
  
  // 回调
  if (!existingRun && onNewRun) {
    onNewRun(run);
  } else if (existingRun && onRunUpdate) {
    onRunUpdate(run);
  }
}

/**
 * 停止监听
 */
export function stopWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

/**
 * 全量重新解析
 */
export async function reparseAll(filePath: string): Promise<void> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  
  // 清空现有数据
  // 注意：这里不清空数据库，只是重新解析
  
  // 按 runId 分组
  const runEntries = new Map<string, CacheTraceEntry[]>();
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    try {
      const entry = JSON.parse(line) as CacheTraceEntry;
      
      if (!runEntries.has(entry.runId)) {
        runEntries.set(entry.runId, []);
      }
      runEntries.get(entry.runId)!.push(entry);
    } catch (e) {
      console.error(`[Watcher] Failed to parse line:`, e);
    }
  }
  
  // 处理每个 runId
  for (const [runId, entries] of runEntries) {
    await processRunEntries(runId, entries);
  }
  
  // 更新文件位置
  db.setFilePosition(filePath, Buffer.byteLength(content, 'utf-8'));
}
