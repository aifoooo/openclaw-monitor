/**
 * 数据库扩展模块
 * 
 * 新增表：
 * - channels: 渠道信息
 * - chats: 聊天信息
 * - operations: 操作记录
 */

import Database from 'better-sqlite3';
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
    INSERT INTO chats (chat_id, channel_id, account_id, session_key, title, last_message_at, message_count, run_count, session_file, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      title = excluded.title,
      last_message_at = excluded.last_message_at,
      message_count = excluded.message_count,
      run_count = excluded.run_count,
      session_file = excluded.session_file,
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
    now,
    now
  );
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
