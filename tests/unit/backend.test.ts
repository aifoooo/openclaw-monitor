import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// 测试环境
const TEST_DIR = '/tmp/openclaw-monitor-test';
const TEST_DB = path.join(TEST_DIR, 'test.db');
const TEST_CACHE_TRACE = path.join(TEST_DIR, 'cache-trace.jsonl');

// 导入路径修正
const SRC_PATH = path.join(__dirname, '../../packages/backend/src');

// 示例 Cache Trace 数据
const sampleEntries = [
  {
    runId: 'test-run-1',
    sessionId: 'test-session-1',
    sessionKey: 'test:session:1',
    provider: 'tencentcodingplan',
    modelId: 'glm-5',
    seq: 1,
    stage: 'stream:context',
    ts: '2026-03-17T00:00:00.000Z',
    messageCount: 10,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    ],
  },
  {
    runId: 'test-run-1',
    sessionId: 'test-session-1',
    sessionKey: 'test:session:1',
    provider: 'tencentcodingplan',
    modelId: 'glm-5',
    seq: 2,
    stage: 'session:after',
    ts: '2026-03-17T00:00:01.000Z',
    messageCount: 11,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] },
    ],
  },
];

describe('Cache Trace Parser', () => {
  beforeAll(() => {
    // 创建测试目录
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
    
    // 写入测试数据
    const content = sampleEntries.map(e => JSON.stringify(e)).join('\n');
    fs.writeFileSync(TEST_CACHE_TRACE, content);
  });
  
  afterAll(() => {
    // 清理测试目录
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });
  
  it('should parse cache trace file', async () => {
    const { parseCacheTraceFile } = await import(path.join(SRC_PATH, 'parser'));
    
    const entries = await parseCacheTraceFile(TEST_CACHE_TRACE);
    
    expect(entries.length).toBe(2);
    expect(entries[0].runId).toBe('test-run-1');
    // entries 是倒序返回的，所以 entries[0] 是最后一条
    expect(entries[0].stage).toBe('session:after');
    expect(entries[1].stage).toBe('stream:context');
  });
  
  it('should convert entries to run', async () => {
    const { parseCacheTraceFile, convertToRun } = await import(path.join(SRC_PATH, 'parser'));
    
    const entries = await parseCacheTraceFile(TEST_CACHE_TRACE);
    const run = convertToRun(entries.reverse()); // 反转因为 parseCacheTraceFile 返回倒序
    
    expect(run).not.toBeNull();
    expect(run!.id).toBe('test-run-1');
    expect(run!.status).toBe('completed');
    expect(run!.messageCount).toBe(10);
  });
});

describe('Database', () => {
  beforeAll(async () => {
    const { initDB } = await import(path.join(SRC_PATH, 'db'));
    initDB(TEST_DB);
  });
  
  afterAll(async () => {
    const { closeDB } = await import(path.join(SRC_PATH, 'db'));
    closeDB();
    
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });
  
  it('should save and retrieve run', async () => {
    const { saveRun, getRunById } = await import(path.join(SRC_PATH, 'db'));
    
    const run = {
      id: 'test-run-2',
      sessionId: 'test-session-2',
      sessionKey: 'test:session:2',
      provider: 'tencentcodingplan',
      modelId: 'glm-5',
      startedAt: Date.now(),
      status: 'running' as const,
      messageCount: 5,
      stages: [],
    };
    
    saveRun(run);
    
    const retrieved = getRunById('test-run-2');
    
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('test-run-2');
    expect(retrieved!.status).toBe('running');
  });
  
  it('should handle websocket messages', async () => {
    const { getNextSeq, saveWSMessage, getUnackedMessages, ackMessage } = await import(path.join(SRC_PATH, 'db'));
    
    const seq = getNextSeq();
    saveWSMessage(seq, 'run:started', { id: 'test-run-3' });
    
    const messages = getUnackedMessages();
    expect(messages.length).toBeGreaterThan(0);
    
    ackMessage(seq);
    
    const afterAck = getUnackedMessages();
    expect(afterAck.find(m => m.seq === seq)).toBeUndefined();
  });
});
