import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createNodeWebSocket } from '@hono/node-ws';
import * as db from '../db';
import * as ws from '../ws';
import { getRecentRuns, getRunById, getRunMessages, parseAllSessions } from '../parser';

export function createApp() {
  const app = new Hono();
  
  // CORS
  app.use('*', cors());
  
  // WebSocket
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  
  // 健康检查
  app.get('/health', (c) => {
    return c.json({ 
      status: 'ok', 
      timestamp: Date.now(),
      connections: ws.getConnectionCount(),
    });
  });
  
  // API 路由
  const api = new Hono();
  
  // 获取 Run 列表
  api.get('/runs', async (c) => {
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    const sessionKey = c.req.query('sessionKey');
    
    try {
      // 先从内存/Cache Trace 解析获取最新数据
      const recentRuns = await getRecentRuns(100);
      
      // 再从数据库获取历史数据
      const dbRuns = db.getRuns({ limit, offset, sessionKey });
      
      // 合并去重
      const runMap = new Map<string, typeof recentRuns[0]>();
      
      for (const run of recentRuns) {
        runMap.set(run.id, run);
      }
      
      for (const run of dbRuns) {
        if (!runMap.has(run.id)) {
          runMap.set(run.id, run);
        }
      }
      
      const allRuns = Array.from(runMap.values())
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(offset, offset + limit);
      
      return c.json({
        runs: allRuns,
        total: runMap.size,
        limit,
        offset,
      });
    } catch (e) {
      console.error('[API] Error getting runs:', e);
      return c.json({ error: 'Failed to get runs' }, 500);
    }
  });
  
  // 获取 Run 详情
  api.get('/runs/:runId', async (c) => {
    const runId = c.req.param('runId');
    
    try {
      const run = await getRunById(runId) || db.getRunById(runId);
      
      if (!run) {
        return c.json({ error: 'Run not found' }, 404);
      }
      
      return c.json(run);
    } catch (e) {
      console.error('[API] Error getting run:', e);
      return c.json({ error: 'Failed to get run' }, 500);
    }
  });
  
  // 获取 Run 消息
  api.get('/runs/:runId/messages', async (c) => {
    const runId = c.req.param('runId');
    
    try {
      const messages = await getRunMessages(runId);
      
      return c.json({
        messages,
        total: messages.length,
      });
    } catch (e) {
      console.error('[API] Error getting messages:', e);
      return c.json({ error: 'Failed to get messages' }, 500);
    }
  });
  
  // 获取 Session 列表
  api.get('/sessions', async (c) => {
    try {
      const sessions = await parseAllSessions();
      
      return c.json({
        sessions,
        total: sessions.length,
      });
    } catch (e) {
      console.error('[API] Error getting sessions:', e);
      return c.json({ error: 'Failed to get sessions' }, 500);
    }
  });
  
  // 挂载 API
  app.route('/api', api);
  
  // WebSocket 路由
  app.get('/ws', upgradeWebSocket(() => ws.createWSHandler()));
  
  return { app, injectWebSocket };
}

export type AppType = ReturnType<typeof createApp>['app'];
