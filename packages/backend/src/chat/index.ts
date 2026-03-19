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
      title = `${channelId} - ${sessionId.substring(0, 8)}`;
    }
    
    // ✅ 如果 sessionKey 只是 "params"，重新构造
    if (sessionKey === 'params' && sessionId) {
      sessionKey = `agent:${accountId}:${channelId}:direct:${sessionId}`;
      title = `${channelId} - ${sessionId.substring(0, 8)}`;
    }
    
    if (!sessionKey) {
      console.log(`[Chat] No sessionKey found in ${filePath}`);
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
  
  // ✅ 新增：agents 目录
  const agentsDir = path.join(openclawDir, 'agents');
  
  // ✅ 不再扫描全局 session 目录，因为那里的消息文件没有 sessionKey
  // 全局消息文件只是消息记录，不应该独立创建聊天
  // 元数据文件在渠道目录中，已经有 sessionKey
  
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
  
  // ✅ 新增：扫描 agents 目录
  if (fs.existsSync(agentsDir)) {
    console.log(`[Chat] Scanning agents directory: ${agentsDir}`);
    const agentDirs = fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    
    console.log(`[Chat] Found agents: ${agentDirs.join(', ')}`);
    
    for (const agentName of agentDirs) {
      // 检查 agent 名称是否匹配当前渠道
      // agent 目录名称格式：{accountId}-{channelId} 或 mime-{channelId}
      const matches = agentName.includes(channelId);
      console.log(`[Chat] Agent ${agentName} matches ${channelId}: ${matches}`);
      
      if (matches) {
        const agentSessionDir = path.join(agentsDir, agentName, 'sessions');
        console.log(`[Chat] Scanning agent session dir: ${agentSessionDir}`);
        
        if (fs.existsSync(agentSessionDir)) {
          const files = fs.readdirSync(agentSessionDir)
            .filter(f => f.endsWith('.jsonl'));
          
          console.log(`[Chat] Found ${files.length} jsonl files in ${agentSessionDir}`);
          
          for (const file of files) {
            const filePath = path.join(agentSessionDir, file);
            const chat = await parseSessionFile(filePath, channelId, agentName);
            if (chat) {
              chats.push(chat);
            }
          }
        }
      }
    }
  } else {
    console.log(`[Chat] Agents directory not found: ${agentsDir}`);
  }
  
  // ✅ 去重：同一个 accountId 只保留 lastMessageAt 最大的 chat
  const chatMap = new Map<string, Chat>();
  for (const chat of chats) {
    const key = `${chat.channelId}:${chat.accountId}`;
    const existing = chatMap.get(key);
    if (!existing || chat.lastMessageAt > existing.lastMessageAt) {
      chatMap.set(key, chat);
    }
  }
  
  const dedupedChats = Array.from(chatMap.values());
  console.log(`[Chat] After dedup: ${dedupedChats.length} chats for channel ${channelId}`);
  
  return dedupedChats;
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
    // 如果有 accounts，扫描每个 account
    if (channel.accounts && channel.accounts.length > 0) {
      for (const account of channel.accounts) {
        const chats = await scanChannelSessions(openclawDir, channel.id, account.id);
        allChats.push(...chats);
      }
    } else {
      // ✅ 如果没有 accounts，从 agents 目录推断
      const agentsDir = path.join(openclawDir, 'agents');
      if (fs.existsSync(agentsDir)) {
        const agentDirs = fs.readdirSync(agentsDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);
        
        // 找到匹配当前渠道的 agent
        for (const agentName of agentDirs) {
          if (agentName.includes(channel.id)) {
            const chats = await scanChannelSessions(openclawDir, channel.id, agentName);
            allChats.push(...chats);
          }
        }
      }
    }
  }
  
  return allChats;
}

/**
 * 获取聊天的消息列表
 * 
 * 从 OpenClaw sessions 目录读取消息文件
 * 支持两种格式：
 * 1. {user, assistant} 对话对格式（OpenClaw sessions）
 * 2. {role, content} 标准格式
 */
export async function getChatMessages(
  sessionFile: string,
  limit: number = 50,
  offset: number = 0
): Promise<Message[]> {
  // OpenClaw 消息文件目录 - 固定路径
  // sessionFile 格式: /root/.openclaw/qqbot/sessions/session-xxx.json
  // 消息文件目录: /root/.openclaw/sessions/
  const openclawDir = path.resolve(sessionFile, '../../..');
  const sessionsDir = path.join(openclawDir, 'sessions');
  
  console.log(`[Chat] Looking for messages in: ${sessionsDir}`);
  
  if (!fs.existsSync(sessionsDir)) {
    console.log(`[Chat] Sessions directory not found: ${sessionsDir}`);
    return [];
  }
  
  // 读取所有 .jsonl 文件
  const files = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .reverse(); // 最新的文件优先
  
  console.log(`[Chat] Found ${files.length} message files`);
  
  // 先收集所有消息，再排序
  const allMessages: Message[] = [];
  
  for (const file of files) {
    const filePath = path.join(sessionsDir, file);
    
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    for await (const line of rl) {
      if (!line.trim()) continue;
      
      try {
        const msg = JSON.parse(line);
        const timestamp = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();
        
        // 格式1: {user, assistant} 对话对格式
        if (msg.user !== undefined || msg.assistant !== undefined) {
          // 添加用户消息
          if (msg.user) {
            allMessages.push({
              id: `${msg.id || timestamp}-user`,
              runId: '',
              role: 'user',
              content: parseContent(msg.user),
              timestamp,
            });
          }
          
          // 添加助手消息
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
        // 格式2: {role, content} 标准格式
        else if (msg.role) {
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
  }
  
  // 按时间戳排序（最早的在前面）
  allMessages.sort((a, b) => a.timestamp - b.timestamp);
  
  // 应用分页
  const pagedMessages = allMessages.slice(offset, offset + limit);
  
  console.log(`[Chat] Loaded ${pagedMessages.length} messages (total: ${allMessages.length})`);
  return pagedMessages;
}
