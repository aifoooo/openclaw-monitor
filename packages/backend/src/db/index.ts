import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { Run, DBCacheTrace, DBRun, MonitorConfig } from '../types';

let db: Database.Database | null = null;

// 安全的 JSON 解析
function safeJSONParse<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('[DB] JSON parse error:', e);
    return fallback;
  }
}

// 初始化数据库
export function initDB(dbPath: string): Database.Database {
  // 确保目录存在
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');  // ✅ 性能优化：减少 fsync
  
  // 创建表
  db.exec(`
    -- ✅ 不再存储原始 cache_traces，只保留聚合后的 runs 表
    -- -- Cache Trace 原始数据
    -- CREATE TABLE IF NOT EXISTS cache_traces (
    --   id INTEGER PRIMARY KEY AUTOINCREMENT,
    --   run_id TEXT NOT NULL,
    --   session_id TEXT NOT NULL,
    --   session_key TEXT NOT NULL,
    --   provider TEXT NOT NULL,
    --   model_id TEXT NOT NULL,
    --   stage TEXT NOT NULL,
    --   seq INTEGER NOT NULL,
    --   timestamp INTEGER NOT NULL,
    --   raw TEXT NOT NULL,
    --   created_at INTEGER NOT NULL
    -- );
    -- 
    -- CREATE INDEX IF NOT EXISTS idx_cache_traces_run_id ON cache_traces(run_id);
    -- CREATE INDEX IF NOT EXISTS idx_cache_traces_timestamp ON cache_traces(timestamp);
    
    -- Run 聚合数据
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT UNIQUE NOT NULL,
      session_id TEXT NOT NULL,
      session_key TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      workspace_dir TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      status TEXT NOT NULL,
      input_messages TEXT,
      output_messages TEXT,
      message_count INTEGER DEFAULT 0,
      stages TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_runs_session_id ON runs(session_id);
    CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);
    
    -- WebSocket 消息
    CREATE TABLE IF NOT EXISTS ws_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seq INTEGER UNIQUE NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      acked_at INTEGER
    );
    
    CREATE INDEX IF NOT EXISTS idx_ws_messages_seq ON ws_messages(seq);
    
    -- 文件位置记录
    CREATE TABLE IF NOT EXISTS file_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT UNIQUE NOT NULL,
      position INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  
  return db;
}

// 获取数据库实例
export function getDB(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

// 关闭数据库
export function closeDB(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ==================== Cache Trace 操作 ====================
// ✅ 已废弃：不再存储原始 cache_traces

export function saveCacheTrace(_entry: DBCacheTrace): void {
  // 不再存储原始 cache_traces
  console.log('[DB] saveCacheTrace: deprecated, skipping');
}

export function getCacheTracesByRunId(_runId: string, _limit: number = 5000): DBCacheTrace[] {
  // 不再存储原始 cache_traces
  return [];
}

// ==================== Run 操作 ====================

export function saveRun(run: Run): void {
  const now = Date.now();
  const stmt = getDB().prepare(`
    INSERT INTO runs (
      run_id, session_id, session_key, provider, model_id,
      workspace_dir, started_at, completed_at, status,
      input_messages, output_messages, message_count, stages, error,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      completed_at = excluded.completed_at,
      status = excluded.status,
      input_messages = excluded.input_messages,
      output_messages = excluded.output_messages,
      stages = excluded.stages,
      error = excluded.error,
      updated_at = excluded.updated_at
  `);
  
  stmt.run(
    run.id,
    run.sessionId,
    run.sessionKey,
    run.provider,
    run.modelId,
    run.workspaceDir || null,
    run.startedAt,
    run.completedAt || null,
    run.status,
    run.inputMessages ? JSON.stringify(run.inputMessages) : null,
    run.outputMessages ? JSON.stringify(run.outputMessages) : null,
    run.messageCount,
    JSON.stringify(run.stages),
    run.error || null,
    now,
    now
  );
}

export function getRuns(options: {
  limit?: number;
  offset?: number;
  sessionKey?: string;
} = {}): Run[] {
  const { limit = 50, offset = 0, sessionKey } = options;
  
  let sql = 'SELECT * FROM runs';
  const params: any[] = [];
  
  if (sessionKey) {
    sql += ' WHERE session_key = ?';
    params.push(sessionKey);
  }
  
  sql += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  
  const stmt = getDB().prepare(sql);
  const rows = stmt.all(...params) as DBRun[];
  
  return rows.map(row => ({
    id: row.run_id,
    sessionId: row.session_id,
    sessionKey: row.session_key,
    provider: row.provider,
    modelId: row.model_id,
    workspaceDir: row.workspace_dir || undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at || undefined,
    status: row.status as 'running' | 'completed' | 'failed',
    inputMessages: safeJSONParse(row.input_messages, undefined),
    outputMessages: safeJSONParse(row.output_messages, undefined),
    messageCount: row.message_count,
    stages: safeJSONParse(row.stages, []),
    error: row.error || undefined,
  }));
}

export function getRunById(runId: string): Run | null {
  const stmt = getDB().prepare('SELECT * FROM runs WHERE run_id = ?');
  const row = stmt.get(runId) as DBRun | undefined;
  
  if (!row) return null;
  
  return {
    id: row.run_id,
    sessionId: row.session_id,
    sessionKey: row.session_key,
    provider: row.provider,
    modelId: row.model_id,
    workspaceDir: row.workspace_dir || undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at || undefined,
    status: row.status as 'running' | 'completed' | 'failed',
    inputMessages: safeJSONParse(row.input_messages, undefined),
    outputMessages: safeJSONParse(row.output_messages, undefined),
    messageCount: row.message_count,
    stages: safeJSONParse(row.stages, []),
    error: row.error || undefined,
  };
}

// ==================== WebSocket 消息操作 ====================

let messageSeq = 0;

export function getNextSeq(): number {
  const stmt = getDB().prepare('SELECT MAX(seq) as max_seq FROM ws_messages');
  const row = stmt.get() as { max_seq: number | null };
  messageSeq = (row.max_seq || 0) + 1;
  return messageSeq;
}

export function saveWSMessage(seq: number, type: string, data: any): void {
  const stmt = getDB().prepare(`
    INSERT INTO ws_messages (seq, type, data, created_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(seq, type, JSON.stringify(data), Date.now());
}

export function getUnackedMessages(sinceSeq?: number): Array<{ seq: number; type: string; data: any }> {
  let sql = 'SELECT seq, type, data FROM ws_messages WHERE acked_at IS NULL';
  const params: any[] = [];
  
  if (sinceSeq !== undefined) {
    sql += ' AND seq > ?';
    params.push(sinceSeq);
  }
  
  sql += ' ORDER BY seq ASC LIMIT 100';
  
  const stmt = getDB().prepare(sql);
  const rows = stmt.all(...params) as Array<{ seq: number; type: string; data: string }>;
  
  return rows.map(row => ({
    seq: row.seq,
    type: row.type,
    data: safeJSONParse(row.data, {}),
  }));
}

export function ackMessage(seq: number): void {
  const stmt = getDB().prepare('UPDATE ws_messages SET acked_at = ? WHERE seq = ?');
  stmt.run(Date.now(), seq);
}

export function ackMessages(seqs: number[]): void {
  const stmt = getDB().prepare('UPDATE ws_messages SET acked_at = ? WHERE seq = ?');
  const now = Date.now();
  
  for (const seq of seqs) {
    stmt.run(now, seq);
  }
}

// ✅ 清理已确认的旧消息（保留最近 1000 条）
export function cleanupOldMessages(): void {
  try {
    const stmt = getDB().prepare(`
      DELETE FROM ws_messages 
      WHERE acked_at IS NOT NULL 
      AND id < (
        SELECT id FROM ws_messages 
        WHERE acked_at IS NOT NULL 
        ORDER BY id DESC 
        LIMIT 1 OFFSET 1000
      )
    `);
    stmt.run();
  } catch (e) {
    console.error('[DB] Cleanup old messages failed:', e);
  }
}

// ==================== 文件位置操作 ====================

export function getFilePosition(filePath: string): number {
  const stmt = getDB().prepare('SELECT position FROM file_positions WHERE file_path = ?');
  const row = stmt.get(filePath) as { position: number } | undefined;
  return row?.position || 0;
}

export function setFilePosition(filePath: string, position: number): void {
  const stmt = getDB().prepare(`
    INSERT INTO file_positions (file_path, position, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      position = excluded.position,
      updated_at = excluded.updated_at
  `);
  stmt.run(filePath, position, Date.now());
}

// ==================== 事务和批量操作 ====================

/**
 * 在事务中执行操作
 */
export function transaction<T>(fn: () => T): T {
  return getDB().transaction(fn)();
}

/**
 * 批量保存 Cache Trace（事务）
 * ✅ 已废弃：不再存储原始 cache_traces
 */
export function saveCacheTracesBatch(_entries: DBCacheTrace[]): void {
  // 不再存储原始 cache_traces
}

/**
 * 原子获取下一个序列号
 */
export function getNextSeqAtomic(): number {
  const db = getDB();
  
  const getNext = db.transaction(() => {
    const stmt = db.prepare('SELECT MAX(seq) as max_seq FROM ws_messages');
    const row = stmt.get() as { max_seq: number | null };
    const nextSeq = (row.max_seq || 0) + 1;
    return nextSeq;
  });
  
  return getNext();
}

/**
 * 保存 WebSocket 消息并返回序列号（原子操作）
 */
export function saveWSMessageAtomic(type: string, data: any): number {
  const db = getDB();
  
  const save = db.transaction(() => {
    const seq = getNextSeqAtomic();
    const stmt = db.prepare(`
      INSERT INTO ws_messages (seq, type, data, created_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(seq, type, JSON.stringify(data), Date.now());
    return seq;
  });
  
  return save();
}

/**
 * 批量确认消息（事务）
 */
export function ackMessagesBatch(seqs: number[]): void {
  const db = getDB();
  const now = Date.now();
  
  const updateMany = db.transaction(() => {
    const stmt = db.prepare('UPDATE ws_messages SET acked_at = ? WHERE seq = ?');
    for (const seq of seqs) {
      stmt.run(now, seq);
    }
  });
  
  updateMany();
}

// ==================== ✅ 性能优化：定期清理 ====================

/**
 * 清理旧的 Cache Traces（保留最近 N 天）
 * ✅ 已废弃：不再存储原始 cache_traces
 */
export function cleanupOldCacheTraces(_daysToKeep: number = 7): number {
  // 不再存储原始 cache_traces
  return 0;
}

/**
 * 清理旧的 Runs（保留最近 N 天）
 */
export function cleanupOldRuns(daysToKeep: number = 30): number {
  const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
  
  try {
    const stmt = getDB().prepare(`
      DELETE FROM runs 
      WHERE started_at < ?
    `);
    const result = stmt.run(cutoffTime);
    
    console.log(`[DB] Cleaned up ${result.changes} old runs (older than ${daysToKeep} days)`);
    return result.changes;
  } catch (e) {
    console.error('[DB] Cleanup runs failed:', e);
    return 0;
  }
}

/**
 * VACUUM 数据库（回收空间）
 */
export function vacuumDatabase(): void {
  try {
    getDB().exec('VACUUM');
    console.log('[DB] Database vacuumed');
  } catch (e) {
    console.error('[DB] Vacuum failed:', e);
  }
}

/**
 * 获取数据库统计信息
 */
export function getStats(): {
  runsCount: number;
  wsMessagesCount: number;
  dbSizeMB: number;
} {
  const db = getDB();
  
  const runsCount = (db.prepare('SELECT COUNT(*) as count FROM runs').get() as { count: number }).count;
  const wsMessagesCount = (db.prepare('SELECT COUNT(*) as count FROM ws_messages').get() as { count: number }).count;
  
  // 数据库文件大小
  const dbPath = db.name;
  let dbSizeMB = 0;
  try {
    const stat = fs.statSync(dbPath);
    dbSizeMB = Math.round(stat.size / 1024 / 1024);
  } catch (e) {}
  
  return {
    runsCount,
    wsMessagesCount,
    dbSizeMB,
  };
}
