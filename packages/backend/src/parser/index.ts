import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import type { 
  CacheTraceEntry, 
  CacheTraceStage,
  Run, 
  StageInfo,
  Session,
  Message,
  Content,
  ToolCall,
  MonitorConfig 
} from '../types';

// 默认配置
const DEFAULT_CONFIG: MonitorConfig = {
  openclawDir: process.env.OPENCLAW_DIR || '/root/.openclaw',
  cacheTracePath: process.env.CACHE_TRACE_PATH || path.join(process.env.HOME || '/root', '.openclaw/logs/cache-trace.jsonl'),
  gatewayLogPath: process.env.GATEWAY_LOG_PATH || '/tmp/openclaw/openclaw-*.log',
  dbPath: process.env.DB_PATH || '/var/lib/openclaw-monitor/monitor.db',
  port: parseInt(process.env.PORT || '3000'),
  wsPort: parseInt(process.env.WS_PORT || '3001'),
  recentLimit: parseInt(process.env.RECENT_LIMIT || '100'),
  cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL || '3600000'),
  cacheTracesDaysToKeep: parseInt(process.env.CACHE_TRACES_DAYS || '7'),
  runsDaysToKeep: parseInt(process.env.RUNS_DAYS || '30'),
};

let config = { ...DEFAULT_CONFIG };

export function getConfig(): MonitorConfig {
  return config;
}

export function setConfig(newConfig: Partial<MonitorConfig>): void {
  config = { ...config, ...newConfig };
}

// ==================== ✅ 性能优化：真正的流式解析 ====================

/**
 * ✅ 优化：从文件末尾倒序读取，真正的流式处理
 * 不再全量加载到内存
 */
export async function parseRecentEntries(
  filePath: string = config.cacheTracePath,
  limit: number = 100
): Promise<CacheTraceEntry[]> {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const fd = await fs.promises.open(filePath, 'r');
  const stat = await fd.stat();
  const fileSize = stat.size;
  
  // 倒序读取，使用固定大小的 buffer
  const CHUNK_SIZE = 64 * 1024; // 64KB 每次读取
  const entries: CacheTraceEntry[] = [];
  let position = fileSize;
  let carryBuffer = '';
  
  try {
    while (position > 0 && entries.length < limit) {
      const readSize = Math.min(CHUNK_SIZE, position);
      position -= readSize;
      
      const chunk = Buffer.alloc(readSize);
      await fd.read(chunk, 0, readSize, position);
      
      // 将新数据拼到前面（倒序读取）
      const chunkStr = chunk.toString('utf-8');
      const content = carryBuffer + chunkStr;
      
      // 按行分割
      const lines = content.split('\n');
      
      // 第一个元素可能不完整（从中间截断），保存到下次处理
      carryBuffer = lines.shift() || '';
      
      // 从后往前处理（因为是从文件末尾往前读）
      for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
        const line = lines[i];
        if (!line.trim()) continue;
        
        try {
          const entry = JSON.parse(line) as CacheTraceEntry;
          entries.push(entry);
        } catch (e) {
          // 解析失败，跳过
        }
      }
    }
    
    // 处理最后的 carry buffer
    if (entries.length < limit && carryBuffer.trim()) {
      try {
        const entry = JSON.parse(carryBuffer) as CacheTraceEntry;
        entries.push(entry);
      } catch (e) {}
    }
  } finally {
    await fd.close();
  }
  
  return entries;
}

/**
 * ✅ 优化：增量解析，真正的文件指针读取
 */
export async function parseCacheTraceIncremental(
  filePath: string,
  startPosition: number,
  options: {
    limit?: number;
  } = {}
): Promise<{ entries: CacheTraceEntry[]; endPosition: number }> {
  let fileSize = 0;
  
  try {
    const stat = await fs.promises.stat(filePath);
    fileSize = stat.size;
  } catch (e) {
    return { entries: [], endPosition: startPosition };
  }
  
  if (fileSize <= startPosition) {
    return { entries: [], endPosition: startPosition };
  }
  
  const entries: CacheTraceEntry[] = [];
  const limit = options.limit || 1000;
  
  // 分批读取，避免一次性分配大 buffer
  const CHUNK_SIZE = 256 * 1024; // 256KB
  let position = startPosition;
  
  const fd = await fs.promises.open(filePath, 'r');
  
  try {
    let carryBuffer = '';
    
    while (position < fileSize && entries.length < limit) {
      const readSize = Math.min(CHUNK_SIZE, fileSize - position);
      const chunk = Buffer.alloc(readSize);
      await fd.read(chunk, 0, readSize, position);
      
      // ✅ 优化：直接处理 chunk，避免字符串累加
      const content = carryBuffer + chunk.toString('utf-8');
      position += readSize;
      
      // 按行分割
      const lines = content.split('\n');
      
      // 保留最后一个可能不完整的行
      carryBuffer = lines.pop() || '';
      
      for (const line of lines) {
        if (entries.length >= limit) break;
        if (!line.trim()) continue;
        
        try {
          entries.push(JSON.parse(line) as CacheTraceEntry);
        } catch (e) {
          // 解析失败，跳过
        }
      }
    }
    
    // 处理最后的 carryBuffer
    if (entries.length < limit && carryBuffer.trim()) {
      try {
        entries.push(JSON.parse(carryBuffer) as CacheTraceEntry);
      } catch (e) {}
    }
  } finally {
    await fd.close();
  }
  
  return { entries, endPosition: fileSize };
}

/**
 * ✅ 废弃：保留接口兼容，但改用优化后的方法
 * @deprecated 使用 parseRecentEntries 替代
 */
export async function parseCacheTraceFileStream(
  filePath: string = config.cacheTracePath,
  options: {
    since?: number;
    runId?: string;
    limit?: number;
  } = {}
): Promise<CacheTraceEntry[]> {
  const entries = await parseRecentEntries(filePath, options.limit || 1000);
  
  // 应用过滤条件
  return entries.filter(entry => {
    if (options.since) {
      const timestamp = new Date(entry.ts).getTime();
      if (timestamp < options.since) return false;
    }
    
    if (options.runId && entry.runId !== options.runId) return false;
    
    return true;
  });
}

/**
 * 解析 Cache Trace 文件（已废弃）
 * @deprecated 使用 parseRecentEntries 替代
 */
export async function parseCacheTraceFile(
  filePath: string = config.cacheTracePath,
  options: {
    since?: number;
    runId?: string;
    limit?: number;
  } = {}
): Promise<CacheTraceEntry[]> {
  return parseCacheTraceFileStream(filePath, options);
}

/**
 * 解析 Cache Trace 并按 runId 分组
 */
export async function parseCacheTraceByRuns(
  filePath?: string,
  options: {
    since?: number;
    limit?: number;
  } = {}
): Promise<Map<string, CacheTraceEntry[]>> {
  const entries = await parseRecentEntries(filePath, options.limit || 100);
  const runs = new Map<string, CacheTraceEntry[]>();
  
  for (const entry of entries) {
    // 过滤条件
    if (options.since) {
      const timestamp = new Date(entry.ts).getTime();
      if (timestamp < options.since) continue;
    }
    
    if (!runs.has(entry.runId)) {
      runs.set(entry.runId, []);
    }
    runs.get(entry.runId)!.push(entry);
  }
  
  // 每个 run 内按 seq 排序
  for (const [_, runEntries] of runs) {
    runEntries.sort((a, b) => a.seq - b.seq);
  }
  
  return runs;
}

/**
 * 将 Cache Trace 条目转换为 Run 对象
 */
export function convertToRun(entries: CacheTraceEntry[]): Run | null {
  if (entries.length === 0) return null;
  
  const first = entries[0];
  
  // 提取 stream:context 作为输入
  const streamContext = entries.find(e => e.stage === 'stream:context');
  const inputMessages = streamContext?.messages;
  
  // 提取 session:after 作为输出
  const sessionAfter = entries.find(e => e.stage === 'session:after');
  const outputMessages = sessionAfter?.messages;
  
  // 构建阶段信息
  const stages: StageInfo[] = entries.map(e => ({
    stage: e.stage,
    seq: e.seq,
    timestamp: new Date(e.ts).getTime(),
    messageCount: e.messageCount,
    note: e.note,
  }));
  
  // 判断状态
  let status: 'running' | 'completed' | 'failed' = 'running';
  if (sessionAfter) {
    status = 'completed';
  }
  
  return {
    id: first.runId,
    sessionId: first.sessionId,
    sessionKey: first.sessionKey,
    provider: first.provider,
    modelId: first.modelId,
    workspaceDir: first.workspaceDir,
    startedAt: new Date(first.ts).getTime(),
    completedAt: sessionAfter ? new Date(sessionAfter.ts).getTime() : undefined,
    status,
    inputMessages,
    outputMessages,
    messageCount: streamContext?.messageCount || 0,
    stages,
  };
}

/**
 * 获取最近的 Runs
 */
export async function getRecentRuns(limit: number = 50): Promise<Run[]> {
  const runsMap = await parseCacheTraceByRuns(undefined, { limit: limit * 2 });
  const runs: Run[] = [];
  
  for (const [_, entries] of runsMap) {
    const run = convertToRun(entries);
    if (run) {
      runs.push(run);
    }
  }
  
  // 按开始时间排序
  runs.sort((a, b) => b.startedAt - a.startedAt);
  
  return runs.slice(0, limit);
}

/**
 * 获取特定 runId 的详情
 */
export async function getRunById(runId: string): Promise<Run | null> {
  // 从文件解析效率太低，应该从数据库获取
  // 这里保留接口兼容，但返回 null（实际从数据库获取）
  return null;
}

/**
 * 获取特定 runId 的消息列表
 */
export async function getRunMessages(runId: string): Promise<Message[]> {
  // 应该从数据库获取，这里保留接口
  return [];
}

// ==================== Session 解析（保留原有功能）====================

const AGENTS_DIR = path.join(config.openclawDir, 'agents');

function validateFilePath(filePath: string): boolean {
  const absolutePath = path.resolve(filePath);
  if (!absolutePath.startsWith(AGENTS_DIR)) {
    console.error(`[Security] Path traversal attempt detected: ${filePath}`);
    return false;
  }
  if (filePath.includes('..') || filePath.includes('\0')) {
    console.error(`[Security] Invalid path pattern: ${filePath}`);
    return false;
  }
  return true;
}

export async function parseSessionFile(filePath: string): Promise<any[]> {
  if (!validateFilePath(filePath)) {
    throw new Error(`Invalid file path: ${filePath}`);
  }
  
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  
  const messages: any[] = [];
  for (const line of lines) {
    if (line.trim()) {
      try {
        messages.push(JSON.parse(line));
      } catch (e) {
        console.error(`Failed to parse line in ${filePath}:`, e);
      }
    }
  }
  
  return messages;
}

export function extractSessionInfo(filePath: string): {
  agentId: string;
  sessionId: string;
} {
  const parts = filePath.split('/');
  const sessionsIndex = parts.indexOf('sessions');
  
  if (sessionsIndex === -1 || sessionsIndex < 2) {
    throw new Error(`Invalid session file path: ${filePath}`);
  }
  
  const agentId = parts[sessionsIndex - 1];
  const sessionId = parts[sessionsIndex + 1].replace('.jsonl', '');
  
  return { agentId, sessionId };
}

export async function getSessionFiles(): Promise<string[]> {
  const pattern = path.join(AGENTS_DIR, '*', 'sessions', '*.jsonl');
  const files = await glob(pattern);
  return files;
}

export async function parseAllSessions(): Promise<any[]> {
  const files = await getSessionFiles();
  const sessions: any[] = [];
  
  for (const file of files) {
    try {
      const { agentId, sessionId } = extractSessionInfo(file);
      const messages = await parseSessionFile(file);
      
      const sessionStart = messages.find((m: any) => m.type === 'session');
      const sessionKey = sessionStart?.id || `agent:${agentId}:unknown:${sessionId}`;
      
      const userMessages = messages.filter((m: any) => m.message?.role === 'user');
      const lastMessage = messages[messages.length - 1];
      const lastTimestamp = lastMessage?.timestamp 
        ? new Date(lastMessage.timestamp).getTime()
        : Date.now();
      
      let title = 'Unknown';
      const firstUserMsg = userMessages[0];
      if (firstUserMsg?.message?.content) {
        const content = firstUserMsg.message.content;
        if (typeof content === 'string') {
          title = content.slice(0, 50);
        } else if (Array.isArray(content)) {
          const textContent = content.find((c: any) => c.type === 'text');
          if (textContent?.text) {
            title = textContent.text.slice(0, 50);
          }
        }
      }
      
      sessions.push({
        id: sessionId,
        channelId: agentId,
        sessionKey,
        title,
        lastMessageAt: lastTimestamp,
        messageCount: userMessages.length,
        sessionFile: file,
      });
    } catch (e) {
      console.error(`Failed to parse session file ${file}:`, e);
    }
  }
  
  sessions.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  
  return sessions;
}
