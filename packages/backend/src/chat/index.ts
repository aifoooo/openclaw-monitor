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
 * 从 sessionKey 中提取正确的 channelId 和 accountId
 * 
 * sessionKey 格式：
 * - agent:mime-qqbot:qqbot:direct:xxx → channelId=qqbot, accountId=mime-qqbot
 * - agent:main:main:direct:xxx → channelId=main, accountId=main
 * - agent:wife-qq:wife-qq:direct:xxx → channelId=local, accountId=wife-qq
 * - qqbot:c2c:xxx → channelId=qqbot, accountId=unknown
 */
function extractChannelAndAccountFromSessionKey(
  sessionKey: string,
  filePath: string
): { channelId: string; accountId: string } {
  const parts = sessionKey.split(':');
  
  // 格式：agent:agentName:channelId:chatType:sessionId
  if (parts[0] === 'agent' && parts.length >= 3) {
    const agentName = parts[1];
    const channelId = parts[2];
    return {
      channelId,
      accountId: agentName,
    };
  }
  
  // 格式：qqbot:c2c:xxx 或 feishu:xxx
  if (parts.length >= 2) {
    const channelId = parts[0];
    const accountId = parts[1];
    return {
      channelId,
      accountId,
    };
  }
  
  // 从文件路径推断
  // /root/.openclaw/agents/mime-qq/sessions/xxx.jsonl → accountId=mime-qq
  const match = filePath.match(/\/agents\/([^\/]+)\/sessions\//);
  if (match) {
    return {
      channelId: 'local',
      accountId: match[1],
    };
  }
  
  return {
    channelId: 'unknown',
    accountId: 'unknown',
  };
}

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
    let firstMessageAt = 0;  // 新增：第一条消息时间
    let sessionKey = '';
    let title = '';
    let sessionId = '';
    
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
        
        // ✅ 飞书格式：从 session 类型的消息中提取 sessionId
        if (!sessionId && msg.type === 'session' && msg.id) {
          sessionId = msg.id;
        }
        
        // ✅ 飞书格式：从 message 类型的消息中提取 sessionKey
        if (!sessionKey && msg.type === 'message' && msg.message?.content) {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const item of content) {
              if (item.type === 'text' && item.text) {
                // 从文本中提取 sessionKey（格式：agent:mime-feishu:feishu:direct:xxx）
                const match = item.text.match(/sessionKey[：:\s]*([a-zA-Z0-9:_-]+)/);
                if (match) {
                  sessionKey = match[1];
                  title = extractTitle(sessionKey);
                }
              }
            }
          }
        }
        
        // 提取时间戳
        const timestamp = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();
        
        // 新增：记录第一条消息的时间
        if (firstMessageAt === 0) {
          firstMessageAt = timestamp;
        }
        
        if (timestamp > lastMessageAt) {
          lastMessageAt = timestamp;
        }
        
        // 提取消息（支持多种格式）
        if (msg.type === 'message' && msg.message) {
          // 飞书格式：{type: "message", message: {role, content}}
          messages.push({
            id: msg.id || `${timestamp}-${messages.length}`,
            runId: msg.runId || '',
            role: msg.message.role || 'user',
            content: msg.message.content || [],
            timestamp,
          });
        } else if (msg.role) {
          // 标准格式：{role, content}
          messages.push({
            id: msg.id || `${timestamp}-${messages.length}`,
            runId: msg.runId || '',
            role: msg.role,
            content: parseContent(msg.content || msg.message),
            timestamp,
          });
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
    
    // ✅ 如果没有 sessionKey，从文件名推断
    if (!sessionKey && sessionId) {
      sessionKey = `agent:${accountId}:${channelId}:direct:${sessionId}`;
      title = extractTitle(sessionKey, firstMessageAt);
    }
    
    // ✅ 如果还是没有 sessionKey，从文件名生成一个
    if (!sessionKey) {
      const fileName = path.basename(filePath, '.jsonl');
      sessionKey = `agent:${accountId}:${channelId}:direct:${fileName}`;
      title = extractTitle(sessionKey, firstMessageAt);
      console.log(`[Chat] Generated sessionKey from filename: ${sessionKey}`);
    }
    
    if (sessionKey === 'params' && sessionId) {
      sessionKey = `agent:${accountId}:${channelId}:direct:${sessionId}`;
      title = extractTitle(sessionKey, firstMessageAt);
    }
    
    // ✅ 改进：使用第一条消息时间生成 title
    if (sessionKey && firstMessageAt > 0) {
      title = extractTitle(sessionKey, firstMessageAt);
    }
    
    if (!sessionKey) {
      console.log(`[Chat] No sessionKey found in ${filePath}`);
      return null;
    }
    
    // ✅ 新增：从 sessionKey 中提取正确的 channelId 和 accountId
    const extractedInfo = extractChannelAndAccountFromSessionKey(sessionKey, filePath);
    const finalChannelId = extractedInfo.channelId || channelId;
    const finalAccountId = extractedInfo.accountId || accountId;
    
    return {
      id: extractChatId(sessionKey),
      channelId: finalChannelId,
      accountId: finalAccountId,
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
 * 格式：时间 + 短ID（例如：03-15 04:00 (7add3c20)）
 */
function extractTitle(sessionKey: string, createdAt?: number): string {
  const parts = sessionKey.split(':');
  
  // 提取 session ID 的最后部分
  const lastPart = parts[parts.length - 1];
  const shortId = lastPart.substring(0, 8);
  
  // 如果有创建时间，显示时间 + ID
  if (createdAt) {
    const date = new Date(createdAt);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hour}:${minute} (${shortId})`;
  }
  
  // 如果没有时间，显示渠道 + ID
  const channelId = parts[1] || parts[0];
  return `${channelId} (${shortId})`;
}

/**
 * 从 sessions.json 读取正确的 sessionFile 路径
 */
function getSessionFileFromSessionsJson(
  sessionsJsonPath: string,
  sessionKeyPrefix: string
): { sessionFile: string; messageCount: number; lastMessageAt: number } | null {
  try {
    const content = fs.readFileSync(sessionsJsonPath, 'utf-8');
    const sessionsData = JSON.parse(content);
    
    // sessionsData 是一个对象，key 是 sessionKey
    for (const [key, value] of Object.entries(sessionsData)) {
      if (key.startsWith(sessionKeyPrefix) || key.includes(sessionKeyPrefix.split(':')[2])) {
        const session = value as any;
        if (session.sessionFile) {
          // 统计消息数量
          let messageCount = 0;
          let lastMessageAt = session.updatedAt || 0;
          
          if (fs.existsSync(session.sessionFile)) {
            const fileContent = fs.readFileSync(session.sessionFile, 'utf-8');
            const lines = fileContent.split('\n');
            for (const line of lines) {
              if (line.includes('"type":"message"')) {
                // 只统计 user/assistant 消息，排除 toolResult
                if (line.includes('"role":"user"') || line.includes('"role":"assistant"')) {
                  messageCount++;
                }
              }
            }
          }
          
          return {
            sessionFile: session.sessionFile,
            messageCount,
            lastMessageAt,
          };
        }
      }
    }
  } catch (e) {
    // 忽略错误
  }
  return null;
}

/**
 * 统计 .jsonl 文件中的消息数量
 * 只统计 user/assistant 消息，不统计 toolResult
 */
function countMessagesInFile(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    let count = 0;
    for (const line of lines) {
      if (line.includes('"type":"message"')) {
        // 只统计 user/assistant 消息，排除 toolResult
        if (line.includes('"role":"user"') || line.includes('"role":"assistant"')) {
          count++;
        }
      }
    }
    return count;
  } catch (e) {
    return 0;
  }
}

/**
 * 扫描所有渠道的 Session
 */
export async function scanAllSessions(
  openclawDir: string,
  channels: Array<{ id: string; accounts: Array<{ id: string }> }>
): Promise<Chat[]> {
  const chats: Chat[] = [];
  
  const agentsDir = path.join(openclawDir, 'agents');
  if (!fs.existsSync(agentsDir)) {
    console.log('[Chat] Agents directory not found');
    return [];
  }
  
  const agentDirs = fs.readdirSync(agentsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  for (const agentName of agentDirs) {
    // ✅ 跳过 main agent（没有关联特定渠道）
    if (agentName === 'main') {
      console.log(`[Chat] Skipping main agent`);
      continue;
    }
    
    const sessionsJsonPath = path.join(agentsDir, agentName, 'sessions', 'sessions.json');
    if (!fs.existsSync(sessionsJsonPath)) {
      console.log(`[Chat] sessions.json not found for agent ${agentName}`);
      continue;
    }
    
    try {
      const content = fs.readFileSync(sessionsJsonPath, 'utf-8');
      const sessionsData = JSON.parse(content);
      
      for (const [sessionKey, sessionInfo] of Object.entries(sessionsData)) {
        const session = sessionInfo as any;
        const sessionFile = session.sessionFile;
        
        if (!sessionFile || !fs.existsSync(sessionFile)) {
          continue;
        }
        
        // 提取正确的 channelId 和 accountId
        const extractedInfo = extractChannelAndAccountFromSessionKey(sessionKey, sessionFile);
        
        // 统计消息数量
        const messageCount = countMessagesInFile(sessionFile);
        
        // 获取最后消息时间
        const lastMessageAt = session.updatedAt || 0;
        
        // 提取 chatId（sessionKey 的最后一部分）
        const chatId = extractChatId(sessionKey);
        
        // 生成标题
        const title = extractTitle(sessionKey, lastMessageAt);
        
        chats.push({
          id: chatId,
          channelId: extractedInfo.channelId,
          accountId: extractedInfo.accountId,
          sessionKey,
          title,
          lastMessageAt,
          messageCount,
          runCount: 0,
          sessionFile,
        });
      }
    } catch (e) {
      console.error(`[Chat] Error parsing sessions.json for ${agentName}:`, e);
    }
  }
  
  // 去重
  const chatMap = new Map<string, Chat>();
  for (const chat of chats) {
    const key = chat.sessionKey;
    const existing = chatMap.get(key);
    if (!existing || (chat.lastMessageAt || 0) > (existing.lastMessageAt || 0)) {
      chatMap.set(key, chat);
    }
  }
  
  const dedupedChats = Array.from(chatMap.values());
  console.log(`[Chat] Total chats after scan: ${dedupedChats.length}`);
  
  return dedupedChats;
}

/**
 * 扫描渠道的所有 Session 文件（简化版，不再使用）
 */
export async function scanChannelSessions(
  openclawDir: string,
  channelId: string,
  accountId: string
): Promise<Chat[]> {
  // 不再使用，由 scanAllSessions 统一处理
  return [];
}

/**
 * 获取聊天的消息列表
 * 
 * 从 sessionFile 指定的 .jsonl 文件读取消息
 * 支持 OpenClaw 的消息格式：{type: "message", message: {role, content}}
 */
export async function getChatMessages(
  sessionFile: string,
  limit: number = 50,
  offset: number = 0
): Promise<Message[]> {
  console.log(`[Chat] Looking for messages in: ${sessionFile}`);
  
  // 检查 sessionFile 是否存在且是 .jsonl 文件
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    console.log(`[Chat] Session file not found: ${sessionFile}`);
    return [];
  }
  
  if (!sessionFile.endsWith('.jsonl')) {
    console.log(`[Chat] Not a .jsonl file: ${sessionFile}`);
    return [];
  }
  
  // 收集所有消息
  const allMessages: Message[] = [];
  
  const fileStream = fs.createReadStream(sessionFile, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  for await (const line of rl) {
    if (!line.trim()) continue;
    
    try {
      const msg = JSON.parse(line);
      
      // OpenClaw 格式：{type: "message", message: {role, content, timestamp}}
      if (msg.type === 'message' && msg.message) {
        const timestamp = msg.message.timestamp 
          ? (typeof msg.message.timestamp === 'number' ? msg.message.timestamp : new Date(msg.message.timestamp).getTime())
          : (msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now());
        
        allMessages.push({
          id: msg.id || `${timestamp}-${allMessages.length}`,
          runId: msg.runId || '',
          role: msg.message.role || 'user',
          content: msg.message.content || [],
          timestamp,
        });
      }
      // 兼容格式：{user, assistant} 对话对格式
      else if (msg.user !== undefined || msg.assistant !== undefined) {
        const timestamp = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();
        
        if (msg.user) {
          allMessages.push({
            id: `${msg.id || timestamp}-user`,
            runId: '',
            role: 'user',
            content: parseContent(msg.user),
            timestamp,
          });
        }
        
        if (msg.assistant) {
          allMessages.push({
            id: `${msg.id || timestamp}-assistant`,
            runId: '',
            role: 'assistant',
            content: parseContent(msg.assistant),
            timestamp,
          });
        }
      }
      // 兼容格式：{role, content} 标准格式
      else if (msg.role) {
        const timestamp = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();
        allMessages.push({
          id: msg.id || `${timestamp}-${allMessages.length}`,
          runId: msg.runId || '',
          role: msg.role,
          content: parseContent(msg.content || msg.message),
          timestamp,
        });
      }
    } catch (e) {
      // 忽略解析错误
    }
  }
  
  // 按时间戳排序（最新的在前面）
  allMessages.sort((a, b) => b.timestamp - a.timestamp);
  
  // 应用分页（offset=0 返回最新的消息）
  const pagedMessages = allMessages.slice(offset, offset + limit);
  
  console.log(`[Chat] Loaded ${pagedMessages.length} messages (total: ${allMessages.length}, offset: ${offset})`);
  return pagedMessages;
}

/**
 * 使用 tail 命令读取大文件的最后部分消息
 * 优化性能，避免解析整个文件
 */
async function getMessagesWithTail(sessionFile: string, count: number): Promise<Message[]> {
  const { execSync } = require('child_process');
  
  try {
    // 使用 tail 读取最后 count * 2 行（因为有些行可能不是消息）
    const lines = execSync(`tail -n ${count * 2} "${sessionFile}"`, { 
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024  // 50MB buffer
    }).split('\n').filter((l: string) => l.trim());
    
    const messages: Message[] = [];
    
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        
        // OpenClaw 格式
        if (msg.type === 'message' && msg.message) {
          const timestamp = msg.message.timestamp 
            ? (typeof msg.message.timestamp === 'number' ? msg.message.timestamp : new Date(msg.message.timestamp).getTime())
            : (msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now());
          
          messages.push({
            id: msg.id || `${timestamp}-${messages.length}`,
            runId: msg.runId || '',
            role: msg.message.role || 'user',
            content: msg.message.content || [],
            timestamp,
          });
        }
        // 兼容其他格式...
        else if (msg.user !== undefined || msg.assistant !== undefined) {
          const timestamp = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();
          if (msg.user) {
            messages.push({
              id: `${msg.id || timestamp}-user`,
              runId: '',
              role: 'user',
              content: parseContent(msg.user),
              timestamp,
            });
          }
          if (msg.assistant) {
            messages.push({
              id: `${msg.id || timestamp}-assistant`,
              runId: '',
              role: 'assistant',
              content: parseContent(msg.assistant),
              timestamp,
            });
          }
        }
        else if (msg.role) {
          const timestamp = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();
          messages.push({
            id: msg.id || `${timestamp}-${messages.length}`,
            runId: msg.runId || '',
            role: msg.role,
            content: parseContent(msg.content || msg.message),
            timestamp,
          });
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
    
    // 按时间戳排序
    messages.sort((a, b) => a.timestamp - b.timestamp);
    
    // 返回最后 count 条消息
    const result = messages.slice(-count);
    console.log(`[Chat] Loaded ${result.length} messages from tail (file: ${sessionFile})`);
    return result;
  } catch (e) {
    console.error(`[Chat] Tail failed:`, e);
    return [];
  }
}
