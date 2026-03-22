/**
 * 聊天管理模块
 * 
 * 从 Session 文件解析聊天信息
 * 
 * ⚠️ 重要：渠道信息必须从配置文件读取，不能随意推断！
 * 
 * 渠道配置来源：
 * 1. OpenClaw 配置文件：~/.openclaw/openclaw.json 的 channels 字段
 * 2. sessions.json：记录当前会话的 sessionKey
 * 
 * sessionKey 格式：agent:{agentName}:{channelId}:{chatType}:{sessionId}
 * - agentName：agent 名称，如 mime-qq, mime-feishu, wife-qq
 * - channelId：渠道 ID，如 qqbot, feishu
 * - chatType：聊天类型，如 direct, group
 * - sessionId：会话 ID
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { Chat, Message } from '../types';

/**
 * ⚠️ 重要：Agent 到渠道的映射
 * 
 * 这个映射基于 OpenClaw 配置文件的 channels 字段。
 * 当无法从 sessionKey 获取渠道时，使用此映射作为 fallback。
 * 
 * 配置文件示例：
 * ```json
 * {
 *   "channels": {
 *     "qqbot": { "accounts": { "mime": {...}, "wife": {...} } },
 *     "feishu": { ... }
 *   }
 * }
 * ```
 * 
 * agentName 格式通常是 {accountName}-{channelId} 或 {channelId}
 * 例如：mime-qq → qqbot, wife-qq → qqbot, mime-feishu → feishu
 */
export const AGENT_TO_CHANNEL_MAP: Record<string, string> = {
  // QQ Bot 渠道
  'mime-qq': 'qqbot',
  'wife-qq': 'qqbot',
  'main': 'qqbot',  // 默认 agent
  
  // 飞书渠道
  'mime-feishu': 'feishu',
  
  // 其他 agent（按需添加）
};

/**
 * 从 sessionKey 中提取正确的 channelId 和 accountId
 * 
 * ⚠️ 重要：优先从 sessionKey 提取，fallback 时使用配置文件映射
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
    
    // ✅ 从 sessionKey 中成功提取，直接返回
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
  
  // ⚠️ Fallback：从文件路径推断 agentName，然后使用映射表确定渠道
  // /root/.openclaw/agents/mime-qq/sessions/xxx.jsonl → accountId=mime-qq
  const match = filePath.match(/\/agents\/([^\/]+)\/sessions\//);
  if (match) {
    const agentName = match[1];
    
    // ✅ 使用配置文件映射表确定渠道
    const channelId = AGENT_TO_CHANNEL_MAP[agentName];
    
    if (channelId) {
      return {
        channelId,
        accountId: agentName,
      };
    }
    
    // ⚠️ 如果映射表中没有，打印警告并返回 unknown
    console.warn(`[Chat] Unknown agent: ${agentName}, please add to AGENT_TO_CHANNEL_MAP`);
    return {
      channelId: 'unknown',
      accountId: agentName,
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
    let firstMessageAt = 0;
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

        // 从 session 类型的消息中提取 sessionId
        if (!sessionId && msg.type === 'session' && msg.id) {
          sessionId = msg.id;
        }

        // 提取时间戳
        const timestamp = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();

        // 记录第一条消息的时间
        if (firstMessageAt === 0) {
          firstMessageAt = timestamp;
        }

        if (timestamp > lastMessageAt) {
          lastMessageAt = timestamp;
        }

        // 提取消息（排除 toolResult 类型）
        if (msg.type === 'message' && msg.message && msg.message.role !== 'toolResult') {
          // 飞书格式：{type: "message", message: {role, content}}
          messages.push({
            id: msg.id || `${timestamp}-${messages.length}`,
            runId: msg.runId || '',
            role: msg.message.role || 'user',
            content: msg.message.content || [],
            timestamp,
          });
        } else if (msg.role && msg.role !== 'toolResult') {
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

    // 使用 sessionId 生成 title
    const title = sessionId ? extractTitle(sessionId, firstMessageAt) : 'Unknown';
    
    // ✅ 检测是否是备份文件（.jsonl.reset.* 或 .jsonl.时间戳）
    const isReset = filePath.includes('.jsonl.reset.') || /\.jsonl\.\d{13}$/.test(filePath);
    
    // ✅ 如果是备份文件，生成不同的 chat_id（添加 _reset 后缀）
    // 这样可以避免与当前会话冲突，同时保留历史记录
    let chatId = sessionId ? `direct:${sessionId}` : '';
    if (isReset && sessionId) {
      // 提取重置时间（从文件名中）
      const resetMatch = filePath.match(/\.reset\.(\d{4}-\d{2}-\d{2}T[\d:-]+\.\d+Z)/);
      const resetTime = resetMatch ? new Date(resetMatch[1]).getTime() : Date.now();
      chatId = `direct:${sessionId}_${resetTime}`;
    }

    return {
      id: chatId,
      channelId,
      accountId,
      sessionKey: '', // 由 scanAgentSessions 设置
      title,
      lastMessageAt,
      messageCount: messages.length,
      runCount: 0,
      sessionFile: filePath,
      isHidden: isReset ? true : false, // ✅ 备份文件标记为隐藏
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
 * 从 sessionId 提取标题（强制使用 sessionId，解决飞书 Open ID 问题）
 * 格式：时间 + 短ID（例如：03-15 04:00 (7add3c20)）
 * 
 * @param sessionId - 真实的 sessionId（必须）
 * @param createdAt - 创建时间
 */
function extractTitle(sessionId: string, createdAt?: number): string {
  // ✅ 检测是否是 reset 文件（备份文件）
  // reset 文件的 sessionId 格式：uuid_时间戳 或包含 _reset_
  const isReset = sessionId.includes('_reset_') || /_\d{13}$/.test(sessionId);
  
  // ✅ 提取 shortId（移除 _reset_时间戳 或 _时间戳 后缀）
  const idPart = sessionId.split('_reset_')[0].split('_')[0];  // 移除所有后缀
  const shortId = idPart.substring(0, 8);       // 取前8位作为短ID
  
  // 如果有创建时间，显示时间 + ID
  if (createdAt) {
    const date = new Date(createdAt);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    
    // ✅ 如果是 reset 文件，添加 [备份] 标记
    const resetMark = isReset ? ' [备份]' : '';
    return `${month}-${day} ${hour}:${minute}${resetMark} (${shortId})`;
  }
  
  // ✅ 如果是 reset 文件，添加 [备份] 标记
  const resetMark = isReset ? ' [备份] ' : '';
  return `${resetMark}${shortId}`;
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
 * 从备份文件名提取重置时间
 * 格式：xxx.jsonl.reset.2026-03-21T11-31-30.009Z
 */
function extractResetTimeFromFilename(filename: string): number | null {
  const match = filename.match(/\.reset\.(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day, hour, minute, second] = match.map(Number);
    try {
      return new Date(year, month - 1, day, hour, minute, second).getTime();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 扫描单个 agent 的 sessions 目录
 * 包括当前会话和历史备份
 */
async function scanAgentSessions(
  agentsDir: string,
  agentName: string
): Promise<Chat[]> {
  const chats: Chat[] = [];
  const sessionsDir = path.join(agentsDir, agentName, 'sessions');
  
  if (!fs.existsSync(sessionsDir)) {
    return chats;
  }
  
  // 读取 sessions.json 获取当前会话信息
  const sessionsJsonPath = path.join(sessionsDir, 'sessions.json');
  let currentSessions: Record<string, any> = {};
  
  if (fs.existsSync(sessionsJsonPath)) {
    try {
      currentSessions = JSON.parse(fs.readFileSync(sessionsJsonPath, 'utf-8'));
    } catch (e) {
      console.error(`[Chat] Error reading sessions.json for ${agentName}:`, e);
    }
  }
  
  // 扫描目录下所有文件
  const files = fs.readdirSync(sessionsDir);
  
  // 按 sessionId 分组（一个 sessionId 可能有多份备份）
  const sessionFiles = new Map<string, Array<{ file: string; isReset: boolean; resetTime: number | null }>>();
  
  for (const file of files) {
    // 只处理 .jsonl 和 .jsonl.reset.* 文件
    if (file.endsWith('.jsonl')) {
      const filePath = path.join(sessionsDir, file);
      const sessionId = file.replace('.jsonl', '');
      if (!sessionFiles.has(sessionId)) {
        sessionFiles.set(sessionId, []);
      }
      sessionFiles.get(sessionId)!.push({ file: filePath, isReset: false, resetTime: null });
    } else if (file.includes('.jsonl.reset.')) {
      // 提取原始 sessionId
      const match = file.match(/^(.+)\.jsonl\.reset\./);
      if (match) {
        const sessionId = match[1];
        const filePath = path.join(sessionsDir, file);
        const resetTime = extractResetTimeFromFilename(file);
        
        if (!sessionFiles.has(sessionId)) {
          sessionFiles.set(sessionId, []);
        }
        sessionFiles.get(sessionId)!.push({
          file: filePath,
          isReset: true,
          resetTime
        });
      }
    }
  }
  
  // 为每个会话生成 Chat 条目
  for (const [sessionId, files] of sessionFiles) {
    // 从 sessions.json 查找对应的 sessionKey
    let currentSessionKey = '';
    let channelId = '';
    let accountId = agentName;
    
    for (const [key, info] of Object.entries(currentSessions)) {
      if (key.endsWith(sessionId) || (info as any).sessionId === sessionId) {
        currentSessionKey = key;
        const extracted = extractChannelAndAccountFromSessionKey(key, '');
        channelId = extracted.channelId;
        accountId = extracted.accountId;
        break;
      }
    }
    
    // ⚠️ 重要：如果没找到 sessionKey，使用 AGENT_TO_CHANNEL_MAP 确定渠道
    if (!currentSessionKey) {
      channelId = AGENT_TO_CHANNEL_MAP[agentName] || 'unknown';
      if (channelId === 'unknown') {
        console.warn(`[Chat] Unknown agent: ${agentName}, please add to AGENT_TO_CHANNEL_MAP`);
      }
      currentSessionKey = `agent:${agentName}:${channelId}:direct:${sessionId}`;
      console.log(`[Chat] No sessionKey found for ${sessionId}, generated: ${currentSessionKey}`);
    }
    
    // 为每个文件生成 Chat
    for (const fileInfo of files) {
      if (!fs.existsSync(fileInfo.file)) continue;
      
      const isCurrent = !fileInfo.isReset;
      console.log(`[Chat] Processing: ${path.basename(fileInfo.file)}, isCurrent=${isCurrent}`);
      
      try {
        // 解析文件获取消息信息
        let chat = await parseSessionFile(fileInfo.file, channelId, accountId);
        
        // ✅ 如果 parseSessionFile 返回 null，创建一个基本的 chat 对象
        if (!chat) {
          console.log(`[Chat] parseSessionFile returned null for ${fileInfo.file}, creating basic chat object`);
          
          // ✅ 即使返回 null，也要统计文件中的消息数
          let messageCount = 0;
          let lastMessageAt = Date.now();
          
          try {
            const fileContent = fs.readFileSync(fileInfo.file, 'utf-8');
            const lines = fileContent.trim().split('\n').filter(l => l.trim());
            for (const line of lines) {
              try {
                const msg = JSON.parse(line);
                // 统计有效消息（type === 'message' 且 role !== 'toolResult'）
                if (msg.type === 'message' && msg.message && msg.message.role !== 'toolResult') {
                  messageCount++;
                  if (msg.message.timestamp) {
                    lastMessageAt = msg.message.timestamp;
                  }
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          } catch (e) {
            console.error(`[Chat] Error counting messages in ${fileInfo.file}:`, e);
          }
          
          chat = {
            id: '',
            channelId,
            accountId,
            sessionKey: currentSessionKey,
            title: '',
            lastMessageAt,
            messageCount,
            runCount: 0,
            sessionFile: fileInfo.file,
          };
          
          console.log(`[Chat] Created basic chat object for ${path.basename(fileInfo.file)}, messageCount=${messageCount}`);
        }
        
        // ✅ 验证并修正渠道信息
        if (chat.channelId === 'unknown' || chat.channelId === 'local') {
          chat.channelId = channelId;
        }
        
        // ✅ 统一使用 sessionId 作为 chat_id
        // 当前会话：direct:sessionId
        // 历史备份：direct:sessionId_resetTime
        if (isCurrent) {
          chat.sessionKey = currentSessionKey;
          chat.id = `direct:${sessionId}`;
          chat.title = extractTitle(sessionId, chat.lastMessageAt || Date.now());
        } else {
          const resetTime = fileInfo.resetTime || Date.now();
          chat.sessionKey = `${currentSessionKey}_reset_${resetTime}`;
          chat.id = `direct:${sessionId}_${resetTime}`;
          chat.title = extractTitle(sessionId, resetTime);
        }
        
        // 修正 sessionFile 路径
        chat.sessionFile = fileInfo.file;
        
        console.log(`[Chat] Added chat: ${chat.title}, id=${chat.id}, sessionFile=${chat.sessionFile}`);
        chats.push(chat);
      } catch (e) {
        console.error(`[Chat] Error parsing ${fileInfo.file}:`, e);
      }
    }
  }
  
  return chats;
}

/**
 * 扫描所有渠道的 Session（包括历史备份）
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
    
    const agentChats = await scanAgentSessions(agentsDir, agentName);
    chats.push(...agentChats);
  }
  
  // 按最后消息时间排序（最新的在前）
  chats.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  
  console.log(`[Chat] Total chats after scan: ${chats.length}`);
  return chats;
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
 * 获取聊天的消息列表（优化版）
 * 
 * 使用 tail 命令从文件末尾读取，避免读取整个大文件
 */
export async function getChatMessages(
  sessionFile: string,
  limit: number = 50,
  offset: number = 0
): Promise<Message[]> {
  console.log(`[Chat] Loading messages from: ${sessionFile}, limit=${limit}, offset=${offset}`);
  
  // 检查 sessionFile 是否存在且是 .jsonl 文件（包括备份文件）
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    console.log(`[Chat] Session file not found: ${sessionFile}`);
    return [];
  }
  
  // ✅ 支持 .jsonl 和 .jsonl.reset.* 文件
  if (!sessionFile.endsWith('.jsonl') && !sessionFile.includes('.jsonl.reset.')) {
    console.log(`[Chat] Not a .jsonl file: ${sessionFile}`);
    return [];
  }
  
  // 使用 tail 命令读取文件末尾的行（性能优化）
  // ✅ 读取足够多的行数，确保过滤后能获取足够的有效消息
  // 预估：有效消息约占 50%，读取 limit * 3 行
  const linesToRead = Math.max((limit + offset) * 3, 1000);
  const { execSync } = require('child_process');
  
  let lines: string[];
  try {
    // 使用 tail -n 读取最后 N 行
    const output = execSync(`tail -n ${linesToRead} "${sessionFile}"`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    });
    lines = output.trim().split('\n').filter((l: string) => l.trim());
  } catch (e) {
    console.error(`[Chat] Failed to read file with tail:`, e);
    return [];
  }
  
  // 解析消息
  const allMessages: Message[] = [];
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    try {
      const msg = JSON.parse(line);
      
      // OpenClaw 格式：{type: "message", message: {role, content, timestamp}}
      // ✅ 排除 toolResult 类型（工具调用结果不应作为独立消息）
      if (msg.type === 'message' && msg.message && msg.message.role !== 'toolResult') {
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
  
  // ✅ 正确的分页逻辑：
  // offset=0: 返回最新的 limit 条消息 [0:limit]
  // offset=50: 返回第 51-100 条消息 [50:100]
  const pagedMessages = allMessages.slice(offset, offset + limit);
  
  console.log(`[Chat] Loaded ${pagedMessages.length} messages (offset=${offset}, limit=${limit}, total=${allMessages.length})`);
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
