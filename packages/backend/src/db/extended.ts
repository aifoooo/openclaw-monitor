/**
 * 数据库扩展模块
 * 
 * 新增表：
 * - channels: 渠道信息
 * - chats: 聊天信息
 * - operations: 操作记录
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { Channel, Chat, Operation, LLMOperation, ToolOperation } from '../types';

let db: Database.Database | null = null;

/**
 * 初始化扩展表
 */
export function initExtendedTables(database: Database.Database): void {
  db = database;
  
  db.exec(`
    -- 渠道表
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'offline',
      accounts TEXT NOT NULL DEFAULT '[]',
      config TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_channels_channel_id ON channels(channel_id);
    
    -- 聊天表
    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT UNIQUE NOT NULL,
      channel_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      session_key TEXT NOT NULL,
      title TEXT NOT NULL,
      last_message_at INTEGER,
      message_count INTEGER DEFAULT 0,
      run_count INTEGER DEFAULT 0,
      session_file TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_chats_channel_id ON chats(channel_id);
    CREATE INDEX IF NOT EXISTS idx_chats_session_key ON chats(session_key);
    CREATE INDEX IF NOT EXISTS idx_chats_last_message_at ON chats(last_message_at);
    
    -- 操作表
    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      op_id TEXT UNIQUE NOT NULL,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      duration INTEGER,
      status TEXT NOT NULL,
      details TEXT,
      created_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_operations_run_id ON operations(run_id);
    CREATE INDEX IF NOT EXISTS idx_operations_start_time ON operations(start_time);
    
    -- 为 runs 表添加新字段（如果不存在）
    -- SQLite 不支持 IF NOT EXISTS for columns，所以使用 try-catch
  `);
  
  // 尝试添加新字段（如果不存在）
  try {
    db.exec(`ALTER TABLE runs ADD COLUMN operations TEXT`);
  } catch (e) {
    // 字段已存在，忽略
  }
  
  try {
    db.exec(`ALTER TABLE runs ADD COLUMN statistics TEXT`);
  } catch (e) {
    // 字段已存在，忽略
  }
  
  try {
    db.exec(`ALTER TABLE runs ADD COLUMN channel_id TEXT`);
  } catch (e) {
    // 字段已存在，忽略
  }
  
  try {
    db.exec(`ALTER TABLE runs ADD COLUMN chat_id TEXT`);
  } catch (e) {
    // 字段已存在，忽略
  }
  
  try {
    db.exec(`ALTER TABLE chats ADD COLUMN is_hidden INTEGER DEFAULT 0`);
  } catch (e) {
    // 字段已存在，忽略
  }
  
  // 创建索引
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_chats_is_hidden ON chats(is_hidden)`);
  } catch (e) {
    // 索引已存在，忽略
  }
}

// ==================== 渠道操作 ====================

export function saveChannel(channel: Channel): void {
  if (!db) throw new Error('Database not initialized');
  
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO channels (channel_id, name, type, status, accounts, config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      status = excluded.status,
      accounts = excluded.accounts,
      config = excluded.config,
      updated_at = excluded.updated_at
  `);
  
  stmt.run(
    channel.id,
    channel.name,
    channel.type,
    channel.status,
    JSON.stringify(channel.accounts || []),
    channel.config ? JSON.stringify(channel.config) : null,
    now,
    now
  );
}

export function getChannels(): Channel[] {
  if (!db) throw new Error('Database not initialized');
  
  const stmt = db.prepare(`SELECT * FROM channels ORDER BY name`);
  const rows = stmt.all() as any[];
  
  return rows.map(row => ({
    id: row.channel_id,
    name: row.name,
    type: row.type,
    status: row.status,
    accounts: JSON.parse(row.accounts || '[]'),
    config: row.config ? JSON.parse(row.config) : undefined,
  }));
}

export function getChannel(channelId: string): Channel | null {
  if (!db) throw new Error('Database not initialized');
  
  const stmt = db.prepare(`SELECT * FROM channels WHERE channel_id = ?`);
  const row = stmt.get(channelId) as any;
  
  if (!row) return null;
  
  return {
    id: row.channel_id,
    name: row.name,
    type: row.type,
    status: row.status,
    accounts: JSON.parse(row.accounts || '[]'),
    config: row.config ? JSON.parse(row.config) : undefined,
  };
}

// ==================== 聊天操作 ====================

export function saveChat(chat: Chat): void {
  if (!db) throw new Error('Database not initialized');
  
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO chats (chat_id, channel_id, account_id, session_key, title, last_message_at, message_count, run_count, session_file, is_hidden, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      title = excluded.title,
      last_message_at = excluded.last_message_at,
      message_count = excluded.message_count,
      run_count = excluded.run_count,
      session_file = excluded.session_file,
      is_hidden = excluded.is_hidden,
      updated_at = excluded.updated_at
  `);
  
  stmt.run(
    chat.id,
    chat.channelId,
    chat.accountId,
    chat.sessionKey,
    chat.title,
    chat.lastMessageAt || null,
    chat.messageCount || 0,
    chat.runCount || 0,
    chat.sessionFile || null,
    chat.isHidden ? 1 : 0,
    now,
    now
  );
}

/**
 * 更新会话的消息数和最后消息时间
 */
export function updateChatStats(chatId: string, messageCount: number, lastMessageAt: number): void {
  if (!db) throw new Error('Database not initialized');
  
  const stmt = db.prepare(`
    UPDATE chats 
    SET message_count = ?, last_message_at = ?, updated_at = ?
    WHERE chat_id = ?
  `);
  
  stmt.run(messageCount, lastMessageAt, Date.now(), chatId);
}

/**
 * 根据会话文件路径查找 chat_id
 */
export function findChatIdBySessionFile(sessionFile: string): string | null {
  if (!db) return null;
  
  const stmt = db.prepare(`SELECT chat_id FROM chats WHERE session_file = ?`);
  const row = stmt.get(sessionFile) as { chat_id: string } | undefined;
  return row?.chat_id || null;
}

/**
 * 增加会话的消息数
 */
export function incrementChatMessageCount(chatId: string, lastMessageAt: number): void {
  if (!db) throw new Error('Database not initialized');
  
  const stmt = db.prepare(`
    UPDATE chats 
    SET message_count = message_count + 1, last_message_at = ?, updated_at = ?
    WHERE chat_id = ?
  `);
  
  stmt.run(lastMessageAt, Date.now(), chatId);
}

/**
 * 生成聊天标题
 */
/**
 * 从 chat_id 中提取 sessionId
 * chat_id 格式：direct:sessionId 或 direct:sessionId_resetTime
 */
function extractSessionIdFromChatId(chatId: string): string {
  // 去掉 "direct:" 前缀
  const idPart = chatId.startsWith('direct:') ? chatId.substring(7) : chatId;
  // 去掉 reset 时间后缀
  return idPart.split('_reset_')[0];
}

function generateTitle(chatId: string, timestamp?: number): string {
  // ✅ 从 chat_id 中提取 sessionId，而不是从 sessionKey
  const sessionId = extractSessionIdFromChatId(chatId);
  const shortId = sessionId.substring(0, 8);
  
  // 如果有时间，显示时间 + ID
  if (timestamp) {
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hour}:${minute} (${shortId})`;
  }
  
  return shortId;
}

/**
 * 同步聊天时间（从消息文件读取最新时间）
 */
export function syncChatTimes(sessionFiles: { chatId: string; sessionFile: string; sessionKey?: string }[]): number {
  if (!db) return 0;
  
  const { execSync } = require('child_process');
  let updated = 0;
  
  for (const { chatId, sessionFile, sessionKey } of sessionFiles) {
    try {
      if (!fs.existsSync(sessionFile) || !sessionFile.endsWith('.jsonl')) {
        continue;
      }
      
      // 使用 tail 读取最后 10 行（找最后一条消息）
      const lastLines = execSync(`tail -n 10 "${sessionFile}"`, {
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
      }).trim();
      
      if (!lastLines) continue;
      
      // 解析最后一条消息
      let lastMessageTime = 0;
      for (const line of lastLines.split('\n').reverse()) {
        if (!line.trim()) continue;
        
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'message' && msg.message) {
            const timestamp = msg.message.timestamp 
              ? (typeof msg.message.timestamp === 'number' ? msg.message.timestamp : new Date(msg.message.timestamp).getTime())
              : (msg.timestamp ? new Date(msg.timestamp).getTime() : 0);
            
            if (timestamp > lastMessageTime) {
              lastMessageTime = timestamp;
            }
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
      
      if (lastMessageTime > 0) {
        // ✅ 使用 chatId 生成标题（而不是 sessionKey）
        const newTitle = generateTitle(chatId, lastMessageTime);
        
        // 更新数据库（同时更新时间和标题）
        const stmt = db!.prepare('UPDATE chats SET last_message_at = ?, title = ? WHERE chat_id = ?');
        stmt.run(lastMessageTime, newTitle, chatId);
        updated++;
      }
    } catch (e) {
      console.error(`[DB] Error syncing time for ${chatId}:`, e);
    }
  }
  
  return updated;
}

export function getChats(channelId?: string, limit: number = 50, offset: number = 0, includeHidden: boolean = false): Chat[] {
  if (!db) throw new Error('Database not initialized');
  
  let stmt;
  const hiddenCondition = includeHidden ? '' : 'AND (is_hidden = 0 OR is_hidden IS NULL)';
  
  if (channelId) {
    stmt = db.prepare(`SELECT * FROM chats WHERE channel_id = ? ${hiddenCondition} ORDER BY last_message_at DESC LIMIT ? OFFSET ?`);
    const rows = stmt.all(channelId, limit, offset) as any[];
    return rows.map(rowToChat);
  } else {
    stmt = db.prepare(`SELECT * FROM chats WHERE 1=1 ${hiddenCondition} ORDER BY last_message_at DESC LIMIT ? OFFSET ?`);
    const rows = stmt.all(limit, offset) as any[];
    return rows.map(rowToChat);
  }
}

export function getChat(chatId: string): Chat | null {
  if (!db) throw new Error('Database not initialized');
  
  const stmt = db.prepare(`SELECT * FROM chats WHERE chat_id = ?`);
  const row = stmt.get(chatId) as any;
  
  return row ? rowToChat(row) : null;
}

export function getChatBySessionKey(sessionKey: string): Chat | null {
  if (!db) throw new Error('Database not initialized');
  
  const stmt = db.prepare(`SELECT * FROM chats WHERE session_key = ?`);
  const row = stmt.get(sessionKey) as any;
  
  return row ? rowToChat(row) : null;
}

/**
 * 隐藏聊天
 */
export function hideChat(chatId: string): void {
  if (!db) throw new Error('Database not initialized');
  
  const now = Date.now();
  const stmt = db.prepare(`UPDATE chats SET is_hidden = 1, updated_at = ? WHERE chat_id = ?`);
  stmt.run(now, chatId);
}

/**
 * 取消隐藏聊天
 */
export function unhideChat(chatId: string): void {
  if (!db) throw new Error('Database not initialized');
  
  const now = Date.now();
  const stmt = db.prepare(`UPDATE chats SET is_hidden = 0, updated_at = ? WHERE chat_id = ?`);
  stmt.run(now, chatId);
}

/**
 * 获取隐藏的聊天列表
 */
export function getHiddenChats(limit: number = 50, offset: number = 0): Chat[] {
  if (!db) throw new Error('Database not initialized');
  
  const stmt = db.prepare(`SELECT * FROM chats WHERE is_hidden = 1 ORDER BY updated_at DESC LIMIT ? OFFSET ?`);
  const rows = stmt.all(limit, offset) as any[];
  return rows.map(rowToChat);
}

/**
 * 获取隐藏聊天数量
 */
export function getHiddenCount(): number {
  if (!db) throw new Error('Database not initialized');
  
  const stmt = db.prepare(`SELECT COUNT(*) as count FROM chats WHERE is_hidden = 1`);
  const row = stmt.get() as any;
  return row?.count || 0;
}

function rowToChat(row: any): Chat {
  return {
    id: row.chat_id,
    channelId: row.channel_id,
    accountId: row.account_id,
    sessionKey: row.session_key,
    title: row.title,
    lastMessageAt: row.last_message_at || undefined,
    messageCount: row.message_count || 0,
    runCount: row.run_count || 0,
    sessionFile: row.session_file || undefined,
    isHidden: row.is_hidden === 1,
  };
}

// ==================== 操作记录 ====================

export function saveOperation(op: Operation): void {
  if (!db) throw new Error('Database not initialized');
  
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO operations (op_id, run_id, type, name, start_time, end_time, duration, status, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(op_id) DO UPDATE SET
      end_time = excluded.end_time,
      duration = excluded.duration,
      status = excluded.status,
      details = excluded.details
  `);
  
  stmt.run(
    op.id,
    op.runId,
    op.type,
    op.name,
    op.startTime,
    op.endTime || null,
    op.duration || null,
    op.status,
    op.details ? JSON.stringify(op.details) : null,
    now
  );
}

export function getOperationsByRunId(runId: string): Operation[] {
  if (!db) throw new Error('Database not initialized');
  
  const stmt = db.prepare(`SELECT * FROM operations WHERE run_id = ? ORDER BY start_time`);
  const rows = stmt.all(runId) as any[];
  
  return rows.map(row => {
    const base: Operation = {
      id: row.op_id,
      runId: row.run_id,
      type: row.type,
      name: row.name,
      startTime: row.start_time,
      endTime: row.end_time || undefined,
      duration: row.duration || undefined,
      status: row.status,
      details: row.details ? JSON.parse(row.details) : undefined,
    };
    
    if (row.type === 'llm') {
      return {
        ...base,
        type: 'llm',
        provider: row.details?.provider,
        model: row.details?.model,
        durationMs: row.duration,
        contextSize: row.details?.contextSize,
      } as LLMOperation;
    } else {
      return {
        ...base,
        type: 'tool',
        toolName: row.name,
        toolCallId: row.op_id,
      } as ToolOperation;
    }
  });
}

export function getOperationCountByRunId(runId: string): { llm: number; tool: number } {
  if (!db) throw new Error('Database not initialized');
  
  const stmt = db.prepare(`
    SELECT type, COUNT(*) as count
    FROM operations
    WHERE run_id = ?
    GROUP BY type
  `);
  
  const rows = stmt.all(runId) as any[];
  
  const result = { llm: 0, tool: 0 };
  for (const row of rows) {
    if (row.type === 'llm') result.llm = row.count;
    if (row.type === 'tool') result.tool = row.count;
  }
  
  return result;
}

// ==================== 统计信息 ====================

export function getDBStats(): {
  channels: number;
  chats: number;
  runs: number;
  operations: number;
} {
  if (!db) throw new Error('Database not initialized');
  
  const channels = (db.prepare(`SELECT COUNT(*) as count FROM channels`).get() as any)?.count || 0;
  const chats = (db.prepare(`SELECT COUNT(*) as count FROM chats`).get() as any)?.count || 0;
  const runs = (db.prepare(`SELECT COUNT(*) as count FROM runs`).get() as any)?.count || 0;
  const operations = (db.prepare(`SELECT COUNT(*) as count FROM operations`).get() as any)?.count || 0;
  
  return { channels, chats, runs, operations };
}

// ==================== 账号管理 ====================

export interface Account {
  channelId: string;
  accountId: string;
  channelName: string;
  accountName: string;
  chatCount: number;
  lastActivity: number | null;
}

/**
 * 获取所有账号（从聊天数据聚合）
 */
export function getAccounts(): Account[] {
  if (!db) throw new Error('Database not initialized');
  
  const stmt = db.prepare(`
    SELECT 
      channel_id,
      account_id,
      session_file,
      COUNT(*) as chat_count,
      MAX(last_message_at) as last_activity
    FROM chats
    WHERE is_hidden = 0
    GROUP BY channel_id, account_id
    ORDER BY last_activity DESC
  `);
  
  const rows = stmt.all() as any[];
  
  // 渠道名称映射
  const channelNames: Record<string, string> = {
    'qqbot': 'QQ',
    'feishu': '飞书',
    'telegram': 'Telegram',
    'discord': 'Discord',
    'signal': 'Signal',
    'whatsapp': 'WhatsApp',
  };
  
  // 从 OpenClaw 配置读取账号名称映射
  const agentNames = loadAgentNames();
  
  // 从 session_file 提取 agentId 并映射到名称
  const extractAgentId = (sessionFile: string): string | null => {
    // /root/.openclaw/agents/mime-qq/sessions/xxx.jsonl -> mime-qq
    const match = sessionFile?.match(/\/agents\/([^\/]+)\/sessions\//);
    return match ? match[1] : null;
  };
  
  return rows.map(row => {
    const agentId = extractAgentId(row.session_file);
    const accountName = (agentId && agentNames[agentId]) || row.account_id;
    
    return {
      channelId: row.channel_id,
      accountId: row.account_id,
      channelName: channelNames[row.channel_id] || row.channel_id,
      accountName,
      chatCount: row.chat_count,
      lastActivity: row.last_activity,
    };
  });
}

/**
 * 从 OpenClaw 配置加载 agent 名称映射
 * agentId -> name
 */
function loadAgentNames(): Record<string, string> {
  const fs = require('fs');
  const path = require('path');
  
  const configPath = path.join(process.env.OPENCLAW_DIR || '/root/.openclaw', 'openclaw.json');
  
  try {
    if (!fs.existsSync(configPath)) {
      return {};
    }
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const agents = config.agents?.list || [];
    
    // 构建 agentId -> name 的映射
    const result: Record<string, string> = {};
    for (const agent of agents) {
      if (agent.id && agent.name) {
        result[agent.id] = agent.name;
      }
    }
    
    return result;
  } catch (e) {
    return {};
  }
}

// ==================== Session 文件同步 ====================

export interface SyncResult {
  added: number;
  removed: number;
  unchanged: number;
  errors: string[];
}

/**
 * 同步 chats 表与 session 文件
 * 
 * 逻辑：
 * 1. 扫描所有 session 文件
 * 2. 文件有，表没有 → 新增
 * 3. 文件没有，表有 → 删除
 */
export function syncChatsWithSessionFiles(
  openclawDir: string,
  channels: Array<{ id: string; accounts: Array<{ id: string }> }>
): SyncResult {
  if (!db) throw new Error('Database not initialized');
  
  const result: SyncResult = {
    added: 0,
    removed: 0,
    unchanged: 0,
    errors: [],
  };
  
  const agentsDir = path.join(openclawDir, 'agents');
  
  if (!fs.existsSync(agentsDir)) {
    result.errors.push('Agents directory not found');
    return result;
  }
  
  // 1. 扫描所有 session 文件
  const sessionFiles = new Set<string>();
  const fileToSessionId = new Map<string, string>();
  
  const agentDirs = fs.readdirSync(agentsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  for (const agentName of agentDirs) {
    const sessionDir = path.join(agentsDir, agentName, 'sessions');
    if (!fs.existsSync(sessionDir)) continue;
    
    const files = fs.readdirSync(sessionDir)
      .filter(f => f.endsWith('.jsonl'));
    
    for (const file of files) {
      const filePath = path.join(sessionDir, file);
      const sessionId = file.replace('.jsonl', '');
      sessionFiles.add(filePath);
      fileToSessionId.set(filePath, sessionId);
    }
  }
  
  console.log(`[Sync] Found ${sessionFiles.size} session files`);
  
  // 2. 获取数据库中所有 chats 的 session_file
  const stmt = db.prepare(`SELECT chat_id, session_file FROM chats`);
  const dbChats = stmt.all() as any[];
  const dbSessionFiles = new Map<string, string>();
  
  for (const chat of dbChats) {
    if (chat.session_file) {
      dbSessionFiles.set(chat.session_file, chat.chat_id);
    }
  }
  
  console.log(`[Sync] Found ${dbSessionFiles.size} chats in database`);
  
  // 3. 找出需要新增的（文件有，表没有）
  const toAdd = new Set<string>();
  for (const filePath of sessionFiles) {
    if (!dbSessionFiles.has(filePath)) {
      toAdd.add(filePath);
    }
  }
  
  // 4. 找出需要删除的（文件没有，表有）
  const toRemove = new Set<string>();
  for (const [filePath, chatId] of dbSessionFiles) {
    if (!sessionFiles.has(filePath)) {
      toRemove.add(chatId);
    }
  }
  
  console.log(`[Sync] To add: ${toAdd.size}, To remove: ${toRemove.size}`);
  
  // 5. 执行新增（这里只是标记，实际的解析由 chat.scanAllSessions 完成）
  // 由于新增需要解析文件内容，我们只记录数量
  result.added = toAdd.size;
  
  // 6. 执行删除
  if (toRemove.size > 0) {
    const deleteStmt = db.prepare(`DELETE FROM chats WHERE chat_id = ?`);
    for (const chatId of toRemove) {
      try {
        deleteStmt.run(chatId);
        result.removed++;
      } catch (e) {
        result.errors.push(`Failed to delete chat ${chatId}: ${e}`);
      }
    }
  }
  
  result.unchanged = sessionFiles.size - toAdd.size;
  
  return result;
}

/**
 * 清理孤立的 chats 记录（session 文件不存在）
 */
export function cleanOrphanedChats(openclawDir: string): number {
  if (!db) throw new Error('Database not initialized');
  
  const agentsDir = path.join(openclawDir, 'agents');
  const existingFiles = new Set<string>();
  
  if (fs.existsSync(agentsDir)) {
    const agentDirs = fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    
    for (const agentName of agentDirs) {
      const sessionDir = path.join(agentsDir, agentName, 'sessions');
      if (!fs.existsSync(sessionDir)) continue;
      
      const files = fs.readdirSync(sessionDir)
        .filter(f => f.endsWith('.jsonl') || f.includes('.jsonl.reset.'));
      
      for (const file of files) {
        existingFiles.add(path.join(sessionDir, file));
      }
    }
  }
  
  // 获取所有 chats
  const stmt = db.prepare(`SELECT chat_id, session_file FROM chats WHERE session_file IS NOT NULL`);
  const chats = stmt.all() as any[];
  
  let removed = 0;
  const deleteStmt = db.prepare(`DELETE FROM chats WHERE chat_id = ?`);
  
  for (const chat of chats) {
    if (chat.session_file && !existingFiles.has(chat.session_file)) {
      deleteStmt.run(chat.chat_id);
      removed++;
    }
  }
  
  return removed;
}
