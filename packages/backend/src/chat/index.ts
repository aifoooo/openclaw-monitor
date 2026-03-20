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
          
          // ✅ 关键修复：从 agents 目录的 sessions.json 读取正确的 sessionFile
          const agentsDir = path.join(openclawDir, 'agents');
          let sessionFile = filePath;
          let messageCount = 0;
          let lastMessageAt = meta.lastConnectedAt || meta.savedAt;
          
          // 查找对应的 agent 目录
          const agentDirs = fs.existsSync(agentsDir) 
            ? fs.readdirSync(agentsDir, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name)
            : [];
          
          // ✅ 修复匹配逻辑：渠道名和目录名的映射
          // qqbot -> *-qq, feishu -> *-feishu
          const channelToSuffix: Record<string, string> = {
            'qqbot': 'qq',
            'feishu': 'feishu',
          };
          const expectedSuffix = channelToSuffix[channelId] || channelId;
          
          for (const agentName of agentDirs) {
            // 匹配：目录名以渠道后缀结尾，且包含账号名
            const matches = (agentName.endsWith('-' + expectedSuffix) || agentName.includes(expectedSuffix)) 
              && agentName.includes(accountFromFileName);
            
            if (matches) {
              const sessionsJsonPath = path.join(agentsDir, agentName, 'sessions', 'sessions.json');
              if (fs.existsSync(sessionsJsonPath)) {
                const sessionInfo = getSessionFileFromSessionsJson(sessionsJsonPath, inferredSessionKey);
                if (sessionInfo) {
                  sessionFile = sessionInfo.sessionFile;
                  messageCount = sessionInfo.messageCount;
                  lastMessageAt = sessionInfo.lastMessageAt;
                  break;
                }
              }
            }
          }
          
          // 创建 Chat 对象
          const chat: Chat = {
            id: extractChatId(inferredSessionKey),
            channelId,
            accountId: meta.accountId || accountId,
            sessionKey: inferredSessionKey,
            title: `${channelId} - ${meta.accountId || accountFromFileName}`,
            lastMessageAt,
            messageCount,
            runCount: 0,
            sessionFile,
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
  
  // ✅ 去重：同一个 sessionKey 只保留 lastMessageAt 最大的 chat
  const chatMap = new Map<string, Chat>();
  for (const chat of chats) {
    const key = chat.sessionKey || `${chat.channelId}:${chat.accountId}:${chat.id}`;
    const existing = chatMap.get(key);
    if (!existing || (chat.lastMessageAt || 0) > (existing.lastMessageAt || 0)) {
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
  
  // ✅ 新增：扫描所有 agent 目录（包括不匹配任何渠道的 agent，如 main）
  const agentsDir = path.join(openclawDir, 'agents');
  if (fs.existsSync(agentsDir)) {
    const agentDirs = fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    
    for (const agentName of agentDirs) {
      // 检查是否已经被扫描过
      const alreadyScanned = channels.some(ch => 
        ch.accounts?.some(acc => acc.id === agentName) || agentName.includes(ch.id)
      );
      
      // 如果没有被扫描过，则扫描
      if (!alreadyScanned) {
        // 对于 main agent，使用 'main' 作为渠道 ID
        const channelId = agentName === 'main' ? 'main' : agentName;
        const chats = await scanChannelSessions(openclawDir, channelId, agentName);
        allChats.push(...chats);
      }
    }
  }
  
  return allChats;
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
