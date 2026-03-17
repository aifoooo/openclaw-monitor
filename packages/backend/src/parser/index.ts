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
  dbPath: process.env.DB_PATH || '/var/lib/openclaw-monitor/monitor.db',
  port: parseInt(process.env.PORT || '3000'),
  wsPort: parseInt(process.env.WS_PORT || '3001'),
};

let config = { ...DEFAULT_CONFIG };

export function getConfig(): MonitorConfig {
  return config;
}

export function setConfig(newConfig: Partial<MonitorConfig>): void {
  config = { ...config, ...newConfig };
}

// ==================== Cache Trace 解析 ====================

/**
 * 解析 Cache Trace 文件
 * @param filePath Cache Trace 文件路径
 * @param options 解析选项
 * @returns 解析后的条目数组
 */
export async function parseCacheTraceFile(
  filePath: string = config.cacheTracePath,
  options: {
    since?: number;           // 只解析此时间戳之后的条目
    runId?: string;           // 只解析特定 runId 的条目
    limit?: number;           // 限制返回数量
  } = {}
): Promise<CacheTraceEntry[]> {
  // 安全验证
  const absolutePath = path.resolve(filePath);
  if (!absolutePath.startsWith(path.resolve(config.openclawDir)) && 
      !absolutePath.startsWith('/tmp') &&
      !absolutePath.includes('.openclaw/logs')) {
    throw new Error(`Invalid file path: ${filePath}`);
  }

  if (!fs.existsSync(filePath)) {
    console.warn(`Cache trace file not found: ${filePath}`);
    return [];
  }

  const content = await fs.promises.readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  
  const entries: CacheTraceEntry[] = [];
  
  for (let i = lines.length - 1; i >= 0 && entries.length < (options.limit || Infinity); i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    
    try {
      const entry = JSON.parse(line) as CacheTraceEntry;
      
      // 过滤条件
      if (options.since) {
        const timestamp = new Date(entry.ts).getTime();
        if (timestamp < options.since) continue;
      }
      
      if (options.runId && entry.runId !== options.runId) continue;
      
      entries.push(entry);
    } catch (e) {
      // 解析失败，跳过
    }
  }
  
  return entries;
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
  const entries = await parseCacheTraceFile(filePath, options);
  const runs = new Map<string, CacheTraceEntry[]>();
  
  for (const entry of entries) {
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
  const last = entries[entries.length - 1];
  
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
  const entries = await parseCacheTraceFile(undefined, { runId });
  return convertToRun(entries.reverse()); // 反转因为 parseCacheTraceFile 返回的是倒序
}

/**
 * 获取特定 runId 的消息列表
 */
export async function getRunMessages(runId: string): Promise<Message[]> {
  const run = await getRunById(runId);
  if (!run) return [];
  
  const messages: Message[] = [];
  const allMessages = [...(run.inputMessages || []), ...(run.outputMessages || [])];
  
  // 去重（基于 timestamp）
  const seen = new Set<number>();
  const uniqueMessages = allMessages.filter(m => {
    if (m.timestamp && seen.has(m.timestamp)) return false;
    if (m.timestamp) seen.add(m.timestamp);
    return true;
  });
  
  for (let i = 0; i < uniqueMessages.length; i++) {
    const msg = uniqueMessages[i];
    messages.push({
      id: `msg-${i}`,
      runId: run.id,
      role: msg.role,
      content: convertContent(msg.content),
      timestamp: msg.timestamp || run.startedAt,
      toolCallId: msg.toolCallId,
      toolName: msg.toolName,
      usage: msg.usage,
      stopReason: msg.stopReason,
      isError: msg.isError,
    });
  }
  
  return messages;
}

/**
 * 转换内容格式
 */
function convertContent(content: any[]): Content[] {
  if (!Array.isArray(content)) return [];
  
  return content.map(c => {
    if (c.type === 'text') {
      return { type: 'text' as const, text: c.text };
    } else if (c.type === 'thinking') {
      return { type: 'thinking' as const, thinking: c.thinking };
    } else if (c.type === 'toolCall') {
      return { 
        type: 'toolCall' as const, 
        toolCall: {
          id: c.id,
          name: c.name,
          arguments: c.arguments,
        } as ToolCall 
      };
    } else if (c.type === 'image') {
      return { type: 'image' as const, image: c.image };
    }
    return { type: 'text' as const, text: JSON.stringify(c) };
  });
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
