/**
 * Gateway 日志解析器
 * 
 * 解析 OpenClaw Gateway 日志，提取工具执行、LLM 调用等信息
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { GatewayLogEntry, Operation, LLMOperation, ToolOperation, ContextDiag } from '../types';

// ==================== 日志解析 ====================

/**
 * 解析 Gateway 日志文件
 */
export async function* parseGatewayLogFile(
  filePath: string,
  options: { tail?: boolean } = {}
): AsyncGenerator<GatewayLogEntry> {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    
    try {
      const entry = parseLogLine(line);
      if (entry) {
        yield entry;
      }
    } catch (e) {
      // 忽略解析错误
    }
  }
}

/**
 * 解析单行日志
 */
export function parseLogLine(line: string): GatewayLogEntry | null {
  try {
    const json = JSON.parse(line);
    
    // 提取消息
    const message = json['1'] || json['0'] || '';
    const subsystem = typeof json['0'] === 'string' && json['0'].startsWith('{')
      ? JSON.parse(json['0']).subsystem
      : json['0']?.subsystem;
    
    const level = json._meta?.logLevelName || 'INFO';
    const timestamp = json.time || json._meta?.date;
    
    // 解析特定类型的日志
    const parsed = parseEmbeddedRunMessage(message) ||
                   parseContextDiagMessage(message) ||
                   { message };
    
    return {
      timestamp,
      level,
      subsystem,
      message,
      ...parsed,
    };
  } catch (e) {
    return null;
  }
}

/**
 * 解析 embedded run 消息
 * 
 * 示例：
 * - embedded run tool start: runId=xxx tool=exec toolCallId=xxx
 * - embedded run tool end: runId=xxx tool=exec toolCallId=xxx
 * - embedded run start: provider=tencentcodingplan model=glm-5
 * - embedded run prompt end: durationMs=34330
 */
export function parseEmbeddedRunMessage(message: string): Partial<GatewayLogEntry> | null {
  // 工具执行开始
  const toolStartMatch = message.match(/embedded run tool start: runId=(\S+) tool=(\S+) toolCallId=(\S+)/);
  if (toolStartMatch) {
    return {
      runId: toolStartMatch[1],
      tool: toolStartMatch[2],
      toolCallId: toolStartMatch[3],
    };
  }
  
  // 工具执行结束
  const toolEndMatch = message.match(/embedded run tool end: runId=(\S+) tool=(\S+) toolCallId=(\S+)/);
  if (toolEndMatch) {
    return {
      runId: toolEndMatch[1],
      tool: toolEndMatch[2],
      toolCallId: toolEndMatch[3],
    };
  }
  
  // LLM 调用开始
  const llmStartMatch = message.match(/embedded run start: provider=(\S+) model=(\S+)/);
  if (llmStartMatch) {
    return {
      provider: llmStartMatch[1],
      model: llmStartMatch[2],
    };
  }
  
  // LLM 调用结束
  const llmEndMatch = message.match(/embedded run prompt end: durationMs=(\d+)/);
  if (llmEndMatch) {
    return {
      durationMs: parseInt(llmEndMatch[1]),
    };
  }
  
  return null;
}

/**
 * 解析 context diag 消息
 * 
 * 示例：
 * [context-diag] pre-prompt:
 *   sessionKey=agent:mime-qq:qqbot:direct:xxx
 *   messages=73
 *   roleCounts=assistant:31,toolResult:33,user:8
 *   historyTextChars=101940
 *   maxMessageTextChars=12241
 *   systemPromptChars=39158
 *   promptChars=1978
 *   provider=tencentcodingplan/glm-5
 */
export function parseContextDiagMessage(message: string): Partial<GatewayLogEntry> | null {
  if (!message.includes('[context-diag]')) {
    return null;
  }
  
  const contextDiag: ContextDiag = {} as any;
  
  const sessionKeyMatch = message.match(/sessionKey=(\S+)/);
  if (sessionKeyMatch) {
    contextDiag.sessionKey = sessionKeyMatch[1];
  }
  
  const messagesMatch = message.match(/messages=(\d+)/);
  if (messagesMatch) {
    contextDiag.messages = parseInt(messagesMatch[1]);
  }
  
  const roleCountsMatch = message.match(/roleCounts=([^\n]+)/);
  if (roleCountsMatch) {
    contextDiag.roleCounts = {};
    roleCountsMatch[1].split(',').forEach(pair => {
      const [role, count] = pair.split(':');
      if (role && count) {
        contextDiag.roleCounts[role] = parseInt(count);
      }
    });
  }
  
  const historyTextCharsMatch = message.match(/historyTextChars=(\d+)/);
  if (historyTextCharsMatch) {
    contextDiag.historyTextChars = parseInt(historyTextCharsMatch[1]);
  }
  
  const maxMessageTextCharsMatch = message.match(/maxMessageTextChars=(\d+)/);
  if (maxMessageTextCharsMatch) {
    contextDiag.maxMessageTextChars = parseInt(maxMessageTextCharsMatch[1]);
  }
  
  const systemPromptCharsMatch = message.match(/systemPromptChars=(\d+)/);
  if (systemPromptCharsMatch) {
    contextDiag.systemPromptChars = parseInt(systemPromptCharsMatch[1]);
  }
  
  const promptCharsMatch = message.match(/promptChars=(\d+)/);
  if (promptCharsMatch) {
    contextDiag.promptChars = parseInt(promptCharsMatch[1]);
  }
  
  const providerMatch = message.match(/provider=(\S+)/);
  if (providerMatch) {
    const [provider, model] = providerMatch[1].split('/');
    contextDiag.provider = provider;
    if (model) {
      // 如果 provider 字段包含 model，存储在 contextDiag 中
    }
  }
  
  return { contextDiag };
}

// ==================== 操作提取 ====================

/**
 * 从 Gateway 日志条目提取操作
 */
export function extractOperations(entries: GatewayLogEntry[]): Map<string, Operation[]> {
  const operationsByRun = new Map<string, Operation[]>();
  const toolStartTimes = new Map<string, number>();
  
  for (const entry of entries) {
    if (!entry.runId) continue;
    
    let operations = operationsByRun.get(entry.runId);
    if (!operations) {
      operations = [];
      operationsByRun.set(entry.runId, operations);
    }
    
    // 工具执行开始
    if (entry.toolCallId && entry.tool && entry.message.includes('start')) {
      const op: ToolOperation = {
        id: entry.toolCallId,
        runId: entry.runId,
        type: 'tool',
        name: entry.tool,
        toolName: entry.tool,
        toolCallId: entry.toolCallId,
        startTime: new Date(entry.timestamp).getTime(),
        status: 'running',
      };
      
      operations.push(op);
      toolStartTimes.set(entry.toolCallId, op.startTime);
    }
    
    // 工具执行结束
    if (entry.toolCallId && entry.tool && entry.message.includes('end')) {
      const startTime = toolStartTimes.get(entry.toolCallId);
      const endTime = new Date(entry.timestamp).getTime();
      
      // 找到对应的操作并更新
      const op = operations.find(o => o.id === entry.toolCallId) as ToolOperation;
      if (op) {
        op.endTime = endTime;
        op.duration = startTime ? endTime - startTime : undefined;
        op.status = 'completed';
      }
    }
    
    // LLM 调用（根据 provider/model）
    if (entry.provider && entry.model) {
      const op: LLMOperation = {
        id: `llm-${entry.runId}-${operations.filter(o => o.type === 'llm').length}`,
        runId: entry.runId!,
        type: 'llm',
        name: `${entry.provider}/${entry.model}`,
        provider: entry.provider,
        model: entry.model,
        startTime: new Date(entry.timestamp).getTime(),
        status: 'running',
        durationMs: entry.durationMs,
      };
      
      operations.push(op);
    }
    
    // LLM 调用结束
    if (entry.durationMs) {
      const llmOps = operations.filter(o => o.type === 'llm' && o.status === 'running');
      if (llmOps.length > 0) {
        const lastOp = llmOps[llmOps.length - 1] as LLMOperation;
        lastOp.endTime = lastOp.startTime + entry.durationMs;
        lastOp.duration = entry.durationMs;
        lastOp.status = 'completed';
      }
    }
    
    // 上下文诊断
    if (entry.contextDiag) {
      const llmOps = operations.filter(o => o.type === 'llm');
      if (llmOps.length > 0) {
        const lastOp = llmOps[llmOps.length - 1] as LLMOperation;
        lastOp.contextSize = {
          messages: entry.contextDiag.messages,
          historyTextChars: entry.contextDiag.historyTextChars,
          systemPromptChars: entry.contextDiag.systemPromptChars,
          promptChars: entry.contextDiag.promptChars,
        };
      }
    }
  }
  
  return operationsByRun;
}

// ==================== 文件监听 ====================

/**
 * 查找最新的 Gateway 日志文件
 */
export function findLatestGatewayLog(basePath: string): string | null {
  // basePath 可能是通配符模式，如 /tmp/openclaw/openclaw-*.log
  const dir = path.dirname(basePath.replace(/\*/g, ''));
  const pattern = path.basename(basePath);
  
  if (!fs.existsSync(dir)) {
    return null;
  }
  
  const files = fs.readdirSync(dir)
    .filter(f => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(f);
      }
      return f === pattern;
    })
    .map(f => ({
      name: f,
      path: path.join(dir, f),
      mtime: fs.statSync(path.join(dir, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime);
  
  return files.length > 0 ? files[0].path : null;
}

/**
 * 读取 Gateway 日志的最后 N 条记录
 */
export async function readLastGatewayLogEntries(
  filePath: string,
  count: number = 100
): Promise<GatewayLogEntry[]> {
  const entries: GatewayLogEntry[] = [];
  
  for await (const entry of parseGatewayLogFile(filePath)) {
    entries.push(entry);
    if (entries.length > count * 2) {
      // 保留最近 2 倍的记录
      entries.shift();
    }
  }
  
  // 返回最后 count 条
  return entries.slice(-count);
}
