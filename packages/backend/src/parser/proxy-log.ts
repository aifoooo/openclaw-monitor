import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import type { ProxyLogEntry } from '../types';

// 配置
const LOG_DIR = process.env.LOG_DIR || '/var/log/openclaw-monitor';

// 读取代理日志（异步）
export async function readProxyLogs(limit: number = 100): Promise<ProxyLogEntry[]> {
  const pattern = path.join(LOG_DIR, 'llm-*.jsonl');
  const files = (await glob(pattern)).sort().reverse(); // 最新的在前
  
  const entries: ProxyLogEntry[] = [];
  
  for (const file of files) {
    if (entries.length >= limit) break;
    
    try {
      const content = await fs.promises.readFile(file, 'utf-8');
      const lines = content.trim().split('\n').reverse(); // 最新的在前
      
      for (const line of lines) {
        if (entries.length >= limit) break;
        if (line.trim()) {
          try {
            entries.push(JSON.parse(line));
          } catch {
            // 忽略解析错误
          }
        }
      }
    } catch (e) {
      console.error(`Failed to read proxy log ${file}:`, e);
    }
  }
  
  return entries;
}

// 根据时间戳查找最近的代理日志（异步）
export async function findProxyLogByTimestamp(timestamp: number, toleranceMs: number = 5000): Promise<ProxyLogEntry | null> {
  const entries = await readProxyLogs(1000);
  
  for (const entry of entries) {
    if (Math.abs(entry.timestamp - timestamp) <= toleranceMs) {
      return entry;
    }
  }
  
  return null;
}

// 合并代理日志到消息（异步）
export async function enrichWithProxyLog(message: any): Promise<any> {
  if (!message.timestamp) return message;
  
  const proxyLog = await findProxyLogByTimestamp(message.timestamp);
  
  if (proxyLog && message.role === 'assistant') {
    // 添加 LLM 请求/响应详情
    return {
      ...message,
      llmDetails: {
        requestPrompt: proxyLog.request.body?.messages,
        responseContent: proxyLog.response.body,
        durationMs: proxyLog.durationMs,
        isStreaming: proxyLog.isStreaming,
      },
    };
  }
  
  return message;
}
