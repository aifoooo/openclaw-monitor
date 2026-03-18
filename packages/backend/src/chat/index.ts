/**
 * 聊天管理模块
 * 
 * 从 Session 文件解析聊天信息
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { Chat, Message } from '../types';

/**
 * 解析 Session 文件
 */
export async function parseSessionFile(
  filePath: string,
  channelId: string,
  accountId: string
): Promise<Chat | null> {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  try {
    const messages: Message[] = [];
    let lastMessageAt = 0;
    let sessionKey = '';
    let title = '';
    
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    for await (const line of rl) {
      if (!line.trim()) continue;
      
      try {
        const msg = JSON.parse(line);
        
        // 提取 sessionKey（从第一条消息）
        if (!sessionKey && msg.sessionKey) {
          sessionKey = msg.sessionKey;
          title = extractTitle(msg.sessionKey);
        }
        
        // 提取时间戳
        const timestamp = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();
        if (timestamp > lastMessageAt) {
          lastMessageAt = timestamp;
        }
        
        // 提取消息
        messages.push({
          id: msg.id || `${timestamp}-${messages.length}`,
          runId: msg.runId || '',
          role: msg.role || 'user',
          content: parseContent(msg.content || msg.message),
          timestamp,
        });
      } catch (e) {
        // 忽略解析错误
      }
    }
    
    if (!sessionKey) {
      return null;
    }
    
    return {
      id: extractChatId(sessionKey),
      channelId,
      accountId,
      sessionKey,
      title,
      lastMessageAt,
      messageCount: messages.length,
      runCount: 0, // 将从 runs 表计算
      sessionFile: filePath,
    };
  } catch (e) {
    console.error(`[Chat] Failed to parse session file: ${filePath}`, e);
    return null;
  }
}

/**
 * 解析消息内容
 */
function parseContent(content: any): any[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  
  if (Array.isArray(content)) {
    return content;
  }
  
  return [{ type: 'text', text: JSON.stringify(content) }];
}

/**
 * 从 sessionKey 提取聊天 ID
 */
function extractChatId(sessionKey: string): string {
  // sessionKey 格式：agent:mime-qq:qqbot:direct:xxx
  // 或者：qqbot:c2c:xxx
  const parts = sessionKey.split(':');
  
  // 找到最后一个部分作为 ID
  const lastPart = parts[parts.length - 1];
  
  // 如果是群聊，使用群 ID
  if (sessionKey.includes('group')) {
    return `group:${lastPart}`;
  }
  
  // 如果是私聊，使用用户 ID
  return `direct:${lastPart}`;
}

/**
 * 从 sessionKey 提取标题
 */
function extractTitle(sessionKey: string): string {
  const parts = sessionKey.split(':');
  
  // 提取渠道和类型
  const channelType = parts.includes('group') ? '群聊' : '私聊';
  const lastPart = parts[parts.length - 1];
  
  // 截取前 8 位作为显示
  const shortId = lastPart.substring(0, 8);
  
  return `${channelType} ${shortId}...`;
}

/**
 * 扫描渠道的所有 Session 文件
 */
export async function scanChannelSessions(
  openclawDir: string,
  channelId: string,
  accountId: string
): Promise<Chat[]> {
  const chats: Chat[] = [];
  
  // 渠道特定的 session 目录
  const channelSessionDir = path.join(openclawDir, channelId, 'sessions');
  
  // 全局 session 目录
  const globalSessionDir = path.join(openclawDir, 'sessions');
  
  // 扫描全局 session 文件
  if (fs.existsSync(globalSessionDir)) {
    const files = fs.readdirSync(globalSessionDir)
      .filter(f => f.endsWith('.jsonl'));
    
    for (const file of files) {
      const filePath = path.join(globalSessionDir, file);
      const chat = await parseSessionFile(filePath, channelId, accountId);
      if (chat) {
        chats.push(chat);
      }
    }
  }
  
  // 扫描渠道特定的 session 文件
  if (fs.existsSync(channelSessionDir)) {
    const files = fs.readdirSync(channelSessionDir)
      .filter(f => f.endsWith('.jsonl') || f.endsWith('.json'));
    
    for (const file of files) {
      const filePath = path.join(channelSessionDir, file);
      
      // 如果是 JSON 文件，解析为 session 元数据
      if (file.endsWith('.json')) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const meta = JSON.parse(content);
          
          // 从文件名推断 sessionKey（格式：session-{account}.json）
          const accountFromFileName = path.basename(file, '.json').replace('session-', '');
          const inferredSessionKey = meta.sessionKey || 
            `agent:${accountId}-${channelId}:${channelId}:direct:${meta.sessionId || accountFromFileName}`;
          
          // 创建 Chat 对象
          const chat: Chat = {
            id: extractChatId(inferredSessionKey),
            channelId,
            accountId: meta.accountId || accountId,
            sessionKey: inferredSessionKey,
            title: meta.title || `${channelId} - ${meta.accountId || accountFromFileName}`,
            lastMessageAt: meta.lastConnectedAt || meta.savedAt,
            messageCount: 0,
            runCount: 0,
            sessionFile: filePath,
          };
          
          chats.push(chat);
        } catch (e) {
          // 忽略解析错误
        }
      } else {
        // 解析 JSONL 文件
        const chat = await parseSessionFile(filePath, channelId, accountId);
        if (chat) {
          chats.push(chat);
        }
      }
    }
  }
  
  console.log(`[Chat] Scanned ${chats.length} chats for channel ${channelId}`);
  
  return chats;
}

/**
 * 扫描所有渠道的 Session
 */
export async function scanAllSessions(
  openclawDir: string,
  channels: Array<{ id: string; accounts: Array<{ id: string }> }>
): Promise<Chat[]> {
  const allChats: Chat[] = [];
  
  for (const channel of channels) {
    for (const account of channel.accounts) {
      const chats = await scanChannelSessions(openclawDir, channel.id, account.id);
      allChats.push(...chats);
    }
  }
  
  return allChats;
}

/**
 * 获取聊天的消息列表
 */
export async function getChatMessages(
  sessionFile: string,
  limit: number = 50,
  offset: number = 0
): Promise<Message[]> {
  if (!fs.existsSync(sessionFile)) {
    return [];
  }
  
  const messages: Message[] = [];
  
  const fileStream = fs.createReadStream(sessionFile, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  let index = 0;
  
  for await (const line of rl) {
    if (!line.trim()) continue;
    
    // 跳过 offset 条消息
    if (index < offset) {
      index++;
      continue;
    }
    
    // 达到 limit 条消息后停止
    if (messages.length >= limit) {
      break;
    }
    
    try {
      const msg = JSON.parse(line);
      const timestamp = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();
      
      messages.push({
        id: msg.id || `${timestamp}-${index}`,
        runId: msg.runId || '',
        role: msg.role || 'user',
        content: parseContent(msg.content || msg.message),
        timestamp,
      });
      
      index++;
    } catch (e) {
      // 忽略解析错误
    }
  }
  
  return messages;
}
