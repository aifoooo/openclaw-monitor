import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import type { SessionMessage, Chat, Message, Operation } from './types';

// 配置
const OPENCLAW_DIR = process.env.OPENCLAW_DIR || '/root/.openclaw';
const AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents');

// 验证文件路径是否在允许的目录内
function validateFilePath(filePath: string): boolean {
  // 解析为绝对路径
  const absolutePath = path.resolve(filePath);
  
  // 检查是否在 AGENTS_DIR 内
  if (!absolutePath.startsWith(AGENTS_DIR)) {
    console.error(`[Security] Path traversal attempt detected: ${filePath}`);
    return false;
  }
  
  // 检查是否包含 .. 或其他可疑模式
  if (filePath.includes('..') || filePath.includes('\0')) {
    console.error(`[Security] Invalid path pattern: ${filePath}`);
    return false;
  }
  
  return true;
}

// 解析单个 session 文件
export function parseSessionFile(filePath: string): SessionMessage[] {
  // 安全验证
  if (!validateFilePath(filePath)) {
    throw new Error(`Invalid file path: ${filePath}`);
  }
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  
  const messages: SessionMessage[] = [];
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

// 从 session 文件路径提取信息
export function extractSessionInfo(filePath: string): {
  agentId: string;
  sessionId: string;
} {
  // 路径格式: /root/.openclaw/agents/{agentId}/sessions/{sessionId}.jsonl
  const parts = filePath.split('/');
  const sessionsIndex = parts.indexOf('sessions');
  
  if (sessionsIndex === -1 || sessionsIndex < 2) {
    throw new Error(`Invalid session file path: ${filePath}`);
  }
  
  const agentId = parts[sessionsIndex - 1];
  const sessionId = parts[sessionsIndex + 1].replace('.jsonl', '');
  
  return { agentId, sessionId };
}

// 获取所有 session 文件
export async function getSessionFiles(): Promise<string[]> {
  const pattern = path.join(AGENTS_DIR, '*', 'sessions', '*.jsonl');
  const files = await glob(pattern);
  return files;
}

// 解析所有 session 文件，返回聊天列表
export async function parseAllSessions(): Promise<Chat[]> {
  const files = await getSessionFiles();
  const chats: Chat[] = [];
  
  for (const file of files) {
    try {
      const { agentId, sessionId } = extractSessionInfo(file);
      const messages = parseSessionFile(file);
      
      // 提取 sessionKey
      const sessionStart = messages.find(m => m.type === 'session');
      const sessionKey = sessionStart?.id || `agent:${agentId}:unknown:${sessionId}`;
      
      // 统计消息
      const userMessages = messages.filter(m => m.message?.role === 'user');
      const lastMessage = messages[messages.length - 1];
      const lastTimestamp = lastMessage?.timestamp 
        ? new Date(lastMessage.timestamp).getTime()
        : Date.now();
      
      // 提取标题（从第一个用户消息）
      const firstUserMsg = userMessages[0];
      let title = 'Unknown';
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
      
      chats.push({
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
  
  // 按最后消息时间排序
  chats.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  
  return chats;
}

// 解析单个 session 文件，返回消息列表
export function parseSessionMessages(filePath: string): Message[] {
  const sessionMessages = parseSessionFile(filePath);
  const messages: Message[] = [];
  const { sessionId } = extractSessionInfo(filePath);
  
  let messageIndex = 0;
  
  for (const sm of sessionMessages) {
    if (sm.type !== 'message' || !sm.message) continue;
    
    const msg = sm.message;
    const timestamp = sm.timestamp ? new Date(sm.timestamp).getTime() : Date.now();
    
    // 处理内容
    let content: any[] = [];
    let operations: Operation[] = [];
    
    if (msg.role === 'user') {
      // 用户消息
      if (typeof msg.content === 'string') {
        content = [{ type: 'text', text: msg.content }];
      } else if (Array.isArray(msg.content)) {
        content = msg.content;
      }
    } else if (msg.role === 'assistant') {
      // 助手消息
      if (Array.isArray(msg.content)) {
        content = msg.content;
        
        // 提取工具调用
        const toolCalls = msg.content.filter((c: any) => c.type === 'toolCall');
        for (const tc of toolCalls) {
          operations.push({
            id: tc.id || `op-${messageIndex}-${operations.length}`,
            messageId: `msg-${messageIndex}`,
            type: 'tool',
            name: tc.name || 'unknown',
            input: tc.arguments || {},
            output: null,
            status: 'completed',
            startedAt: timestamp,
            completedAt: timestamp,
            durationMs: 0,
          });
        }
      }
    } else if (msg.role === 'toolResult') {
      // 工具结果
      content = msg.content || [];
    }
    
    messages.push({
      id: `msg-${messageIndex}`,
      chatId: sessionId,
      role: msg.role,
      content,
      timestamp,
      operations: operations.length > 0 ? operations : undefined,
      usage: msg.usage,
    });
    
    messageIndex++;
  }
  
  return messages;
}
