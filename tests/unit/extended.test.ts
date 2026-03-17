import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// 测试环境
const TEST_DIR = '/tmp/openclaw-monitor-test-extended';
const TEST_DB = path.join(TEST_DIR, 'test.db');

// 导入路径
const SRC_PATH = path.join(__dirname, '../../packages/backend/src');

describe('Extended Database Operations', () => {
  beforeAll(async () => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
    
    const { initDB } = await import(path.join(SRC_PATH, 'db'));
    const db = initDB(TEST_DB);
    
    const { initExtendedTables } = await import(path.join(SRC_PATH, 'db/extended'));
    initExtendedTables(db);
  });
  
  afterAll(async () => {
    const { closeDB } = await import(path.join(SRC_PATH, 'db'));
    closeDB();
    
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });
  
  it('should save and retrieve channel', async () => {
    const { saveChannel, getChannel, getChannels } = await import(path.join(SRC_PATH, 'db/extended'));
    
    const channel = {
      id: 'test-qqbot',
      name: 'Test QQ Bot',
      type: 'qqbot',
      status: 'online' as const,
      accounts: [
        { id: 'mime', name: 'Mime Account', enabled: true },
      ],
    };
    
    saveChannel(channel);
    
    const retrieved = getChannel('test-qqbot');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe('Test QQ Bot');
    expect(retrieved!.accounts.length).toBe(1);
    
    const allChannels = getChannels();
    expect(allChannels.length).toBeGreaterThan(0);
  });
  
  it('should save and retrieve chat', async () => {
    const { saveChat, getChat, getChats } = await import(path.join(SRC_PATH, 'db/extended'));
    
    const chat = {
      id: 'test-chat-1',
      channelId: 'test-qqbot',
      accountId: 'mime',
      sessionKey: 'agent:mime-qq:qqbot:direct:test123',
      title: 'Test Chat',
      lastMessageAt: Date.now(),
      messageCount: 10,
      runCount: 5,
    };
    
    saveChat(chat);
    
    const retrieved = getChat('test-chat-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe('Test Chat');
    expect(retrieved!.messageCount).toBe(10);
  });
  
  it('should save and retrieve operations', async () => {
    const { saveOperation, getOperationsByRunId, getOperationCountByRunId } = await import(path.join(SRC_PATH, 'db/extended'));
    
    // LLM 操作
    const llmOp = {
      id: 'llm-test-run-1-0',
      runId: 'test-run-1',
      type: 'llm' as const,
      name: 'tencentcodingplan/glm-5',
      startTime: Date.now() - 1000,
      endTime: Date.now(),
      duration: 1000,
      status: 'completed' as const,
      details: {
        provider: 'tencentcodingplan',
        model: 'glm-5',
      },
    };
    
    // Tool 操作
    const toolOp = {
      id: 'tool-test-run-1-0',
      runId: 'test-run-1',
      type: 'tool' as const,
      name: 'exec',
      startTime: Date.now() - 500,
      endTime: Date.now() - 100,
      duration: 400,
      status: 'completed' as const,
    };
    
    saveOperation(llmOp);
    saveOperation(toolOp);
    
    const operations = getOperationsByRunId('test-run-1');
    expect(operations.length).toBe(2);
    
    const count = getOperationCountByRunId('test-run-1');
    expect(count.llm).toBe(1);
    expect(count.tool).toBe(1);
  });
  
  it('should get database stats', async () => {
    const { getDBStats } = await import(path.join(SRC_PATH, 'db/extended'));
    
    const stats = getDBStats();
    
    expect(stats).toHaveProperty('channels');
    expect(stats).toHaveProperty('chats');
    expect(stats).toHaveProperty('runs');
    expect(stats).toHaveProperty('operations');
    expect(stats.channels).toBeGreaterThan(0);
    expect(stats.chats).toBeGreaterThan(0);
  });
});

describe('Channel Parser', () => {
  const testConfigDir = path.join(TEST_DIR, 'openclaw');
  const testConfigFile = path.join(testConfigDir, 'openclaw.json');
  
  beforeAll(() => {
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }
    
    const testConfig = {
      channels: {
        qqbot: {
          enabled: true,
          accounts: {
            mime: {
              enabled: true,
              appId: '1903079409',
            },
          },
        },
        feishu: {
          enabled: true,
          accounts: {
            default: {
              enabled: true,
              appId: 'cli_test123',
            },
          },
        },
      },
    };
    
    fs.writeFileSync(testConfigFile, JSON.stringify(testConfig, null, 2));
  });
  
  it('should parse openclaw config', async () => {
    const { parseOpenClawConfig } = await import(path.join(SRC_PATH, 'channel'));
    
    const result = parseOpenClawConfig(testConfigDir);
    
    expect(result.channels.length).toBe(2);
    
    const qqbot = result.channels.find(c => c.id === 'qqbot');
    expect(qqbot).not.toBeUndefined();
    expect(qqbot!.name).toBe('QQ Bot');
    expect(qqbot!.accounts.length).toBe(1);
    
    const feishu = result.channels.find(c => c.id === 'feishu');
    expect(feishu).not.toBeUndefined();
    expect(feishu!.name).toBe('飞书');
  });
});

describe('Gateway Log Parser', () => {
  const testLogFile = path.join(TEST_DIR, 'gateway-test.log');
  
  beforeAll(() => {
    const logLines = [
      JSON.stringify({
        time: '2026-03-17T12:00:00.000Z',
        '0': { subsystem: 'gateway/channels/qqbot' },
        '1': 'embedded run tool start: runId=test-run-1 tool=exec toolCallId=tc-1',
        _meta: { logLevelName: 'DEBUG' },
      }),
      JSON.stringify({
        time: '2026-03-17T12:00:01.000Z',
        '1': 'embedded run tool end: runId=test-run-1 tool=exec toolCallId=tc-1',
        _meta: { logLevelName: 'DEBUG' },
      }),
      JSON.stringify({
        time: '2026-03-17T12:00:02.000Z',
        '1': 'embedded run start: provider=tencentcodingplan model=glm-5',
        _meta: { logLevelName: 'DEBUG' },
      }),
      JSON.stringify({
        time: '2026-03-17T12:00:35.000Z',
        '1': 'embedded run prompt end: durationMs=33000',
        _meta: { logLevelName: 'DEBUG' },
      }),
    ];
    
    fs.writeFileSync(testLogFile, logLines.join('\n'));
  });
  
  it('should parse gateway log file', async () => {
    const { parseGatewayLogFile } = await import(path.join(SRC_PATH, 'gateway-log'));
    
    const entries = [];
    for await (const entry of parseGatewayLogFile(testLogFile)) {
      entries.push(entry);
    }
    
    expect(entries.length).toBe(4);
    
    // 检查工具执行
    const toolStart = entries.find(e => e.toolCallId === 'tc-1');
    expect(toolStart).not.toBeUndefined();
    expect(toolStart!.tool).toBe('exec');
  });
  
  it('should extract operations from entries', async () => {
    const { parseGatewayLogFile, extractOperations } = await import(path.join(SRC_PATH, 'gateway-log'));
    
    const entries = [];
    for await (const entry of parseGatewayLogFile(testLogFile)) {
      entries.push(entry);
    }
    
    const operationsByRun = extractOperations(entries);
    
    expect(operationsByRun.size).toBeGreaterThan(0);
    
    const ops = operationsByRun.get('test-run-1');
    expect(ops).not.toBeUndefined();
    expect(ops!.length).toBeGreaterThan(0);
  });
});
