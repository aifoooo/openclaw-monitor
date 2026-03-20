/**
 * API 路由扩展
 * 
 * 新增端点：
 * - /api/channels - 渠道管理
 * - /api/accounts - 账号管理（从聊天数据中聚合）
 * - /api/chats - 聊天管理
 * - /api/runs/:runId/operations - 操作追踪
 */

import { Hono } from 'hono';
import * as db from '../db';
import * as dbExt from '../db/extended';
import * as channel from '../channel';
import * as chat from '../chat';
import type { MonitorConfig } from '../types';

// ✅ 定时同步任务
let syncTimer: NodeJS.Timeout | null = null;

export function startChatTimeSync(intervalMs: number = 60000, config?: MonitorConfig): void {
  if (syncTimer) {
    clearInterval(syncTimer);
  }
  
  syncTimer = setInterval(() => {
    try {
      if (!config) {
        console.error('[Monitor] No config available for sync');
        return;
      }
      
      // ✅ 每分钟同步时间和 session_file
      // 1. 重新扫描所有 session（从 sessions.json 读取最新的 sessionFile）
      const channels = dbExt.getChannels();
      chat.scanAllSessions(config.openclawDir, channels).then(newChats => {
        // 2. 保存（会更新 session_file 字段）
        newChats.forEach(ch => dbExt.saveChat(ch));
        
        // 3. 同步时间
        const chats = dbExt.getChats(undefined, 100, 0);
        
        if (chats.length > 0) {
          // 过滤掉没有 sessionFile 的 chats
          const syncItems = chats
            .filter(c => c.sessionFile)
            .map(c => ({
              chatId: c.id,
              sessionFile: c.sessionFile!,
              sessionKey: c.sessionKey,
            }));
          
          if (syncItems.length > 0) {
            // 同步时间
            const updated = dbExt.syncChatTimes(syncItems);
            
            if (updated > 0) {
              console.log(`[Monitor] Synced ${updated} chat times`);
            }
          }
        }
      }).catch(e => {
        console.error('[Monitor] Error in sync task:', e);
      });
    } catch (e) {
      console.error('[Monitor] Error syncing chat times:', e);
    }
  }, intervalMs);
  
  console.log(`[Monitor] Chat time sync started, interval: ${intervalMs}ms`);
}

export function stopChatTimeSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

export function createExtendedRoutes(config: MonitorConfig): Hono {
  const api = new Hono();
  
  // ✅ 启动定时同步（1分钟）
  startChatTimeSync(60000, config);
  
  // ==================== 渠道管理 ====================
  
  /**
   * GET /api/channels - 获取渠道列表
   */
  api.get('/channels', (c) => {
    try {
      // 从数据库获取
      let channels = dbExt.getChannels();
      
      // 如果数据库为空，从配置文件解析
      if (channels.length === 0) {
        const result = channel.parseOpenClawConfig(config.openclawDir);
        channels = result.channels;
        
        // 保存到数据库
        channels.forEach(ch => dbExt.saveChannel(ch));
      }
      
      return c.json({
        channels,
        total: channels.length,
      });
    } catch (e) {
      console.error('[API] Error getting channels:', e);
      return c.json({ error: 'Failed to get channels' }, 500);
    }
  });
  
  /**
   * GET /api/accounts - 获取账号列表（从聊天数据聚合）
   * 过滤掉 default 账号
   */
  api.get('/accounts', (c) => {
    try {
      // 从数据库获取所有账号（排除 default）
      const accounts = dbExt.getAccounts().filter(acc => !(acc.channelId === 'qqbot' && acc.accountId === 'default'));
      
      return c.json({
        accounts,
        total: accounts.length,
      });
    } catch (e) {
      console.error('[API] Error getting accounts:', e);
      return c.json({ error: 'Failed to get accounts' }, 500);
    }
  });
  
  /**
   * GET /api/channels/:channelId - 获取渠道详情
   */
  api.get('/channels/:channelId', (c) => {
    const channelId = c.req.param('channelId');
    
    try {
      const ch = dbExt.getChannel(channelId);
      
      if (!ch) {
        return c.json({ error: 'Channel not found' }, 404);
      }
      
      // 获取该渠道的统计信息
      const stats = {
        chatCount: 0,
        runCount: 0,
        lastActivity: null as number | null,
      };
      
      // TODO: 从数据库计算统计信息
      
      return c.json({
        channel: ch,
        stats,
      });
    } catch (e) {
      console.error('[API] Error getting channel:', e);
      return c.json({ error: 'Failed to get channel' }, 500);
    }
  });
  
  /**
   * POST /api/channels/refresh - 刷新渠道信息
   */
  api.post('/channels/refresh', (c) => {
    try {
      const result = channel.parseOpenClawConfig(config.openclawDir);
      
      // 保存到数据库
      result.channels.forEach(ch => dbExt.saveChannel(ch));
      
      return c.json({
        status: 'ok',
        channels: result.channels.length,
        message: 'Channels refreshed successfully',
      });
    } catch (e) {
      console.error('[API] Error refreshing channels:', e);
      return c.json({ error: 'Failed to refresh channels' }, 500);
    }
  });
  
  // ==================== 聊天管理 ====================
  
  /**
   * GET /api/chats - 获取聊天列表
   */
  api.get('/chats', (c) => {
    const channelId = c.req.query('channelId');
    const limitParam = c.req.query('limit');
    const offsetParam = c.req.query('offset');
    const includeHidden = c.req.query('includeHidden') === 'true';
    
    const limit = parseInt(limitParam || '50');
    const offset = parseInt(offsetParam || '0');
    
    try {
      const chats = dbExt.getChats(channelId, limit, offset, includeHidden);
      
      return c.json({
        chats,
        total: chats.length,
        limit,
        offset,
      });
    } catch (e) {
      console.error('[API] Error getting chats:', e);
      return c.json({ error: 'Failed to get chats' }, 500);
    }
  });
  
  /**
   * GET /api/chats/hidden - 获取隐藏的聊天列表
   */
  api.get('/chats/hidden', (c) => {
    const limitParam = c.req.query('limit');
    const offsetParam = c.req.query('offset');
    
    const limit = parseInt(limitParam || '50');
    const offset = parseInt(offsetParam || '0');
    
    try {
      const chats = dbExt.getHiddenChats(limit, offset);
      const hiddenCount = dbExt.getHiddenCount();
      
      return c.json({
        chats,
        total: hiddenCount,
        limit,
        offset,
      });
    } catch (e) {
      console.error('[API] Error getting hidden chats:', e);
      return c.json({ error: 'Failed to get hidden chats' }, 500);
    }
  });
  
  /**
   * GET /api/chats/hidden/count - 获取隐藏聊天数量
   */
  api.get('/chats/hidden/count', (c) => {
    try {
      const count = dbExt.getHiddenCount();
      return c.json({ count });
    } catch (e) {
      console.error('[API] Error getting hidden count:', e);
      return c.json({ error: 'Failed to get hidden count' }, 500);
    }
  });
  
  /**
   * POST /api/chats/:chatId/hide - 隐藏聊天
   */
  api.post('/chats/:chatId/hide', (c) => {
    const chatId = c.req.param('chatId');
    
    try {
      const ch = dbExt.getChat(chatId);
      if (!ch) {
        return c.json({ error: 'Chat not found' }, 404);
      }
      
      dbExt.hideChat(chatId);
      
      return c.json({
        status: 'ok',
        message: 'Chat hidden successfully',
        chatId,
      });
    } catch (e) {
      console.error('[API] Error hiding chat:', e);
      return c.json({ error: 'Failed to hide chat' }, 500);
    }
  });
  
  /**
   * POST /api/chats/:chatId/unhide - 取消隐藏聊天
   */
  api.post('/chats/:chatId/unhide', (c) => {
    const chatId = c.req.param('chatId');
    
    try {
      const ch = dbExt.getChat(chatId);
      if (!ch) {
        return c.json({ error: 'Chat not found' }, 404);
      }
      
      dbExt.unhideChat(chatId);
      
      return c.json({
        status: 'ok',
        message: 'Chat unhidden successfully',
        chatId,
      });
    } catch (e) {
      console.error('[API] Error unhiding chat:', e);
      return c.json({ error: 'Failed to unhide chat' }, 500);
    }
  });
  
  /**
   * GET /api/chats/:chatId - 获取聊天详情
   */
  api.get('/chats/:chatId', async (c) => {
    const chatId = c.req.param('chatId');
    
    try {
      const ch = dbExt.getChat(chatId);
      
      if (!ch) {
        return c.json({ error: 'Chat not found' }, 404);
      }
      
      // 获取消息列表
      let messages: any[] = [];
      if (ch.sessionFile) {
        messages = await chat.getChatMessages(ch.sessionFile, 20);
      }
      
      // 获取 Run 列表
      const runs = db.getRuns({ limit: 10 });
      
      return c.json({
        chat: ch,
        messages,
        runs,
      });
    } catch (e) {
      console.error('[API] Error getting chat:', e);
      return c.json({ error: 'Failed to get chat' }, 500);
    }
  });
  
  /**
   * GET /api/chats/:chatId/messages - 获取聊天消息
   * 支持滚动加载：
   * - limit: 每次返回的消息数（默认 10）
   * - offset: 从最新消息往前偏移（默认 0）
   * - 返回 total 和 hasMore 用于前端判断是否还有更多
   */
  api.get('/chats/:chatId/messages', async (c) => {
    const chatId = c.req.param('chatId');
    const limitParam = c.req.query('limit');
    const offsetParam = c.req.query('offset');
    
    const limit = parseInt(limitParam || '10');
    const offset = parseInt(offsetParam || '0');
    
    try {
      const ch = dbExt.getChat(chatId);
      
      if (!ch) {
        return c.json({ error: 'Chat not found' }, 404);
      }
      
      let messages: any[] = [];
      let total = 0;
      
      if (ch.sessionFile) {
        // 使用优化后的消息读取
        messages = await chat.getChatMessages(ch.sessionFile, limit, offset);
        // 从数据库获取总消息数
        total = ch.messageCount || messages.length;
      }
      
      return c.json({
        messages,
        total,
        limit,
        offset,
        hasMore: offset + messages.length < total,
      });
    } catch (e) {
      console.error('[API] Error getting messages:', e);
      return c.json({ error: 'Failed to get messages' }, 500);
    }
  });
  
  /**
   * POST /api/chats/scan - 扫描聊天
   */
  api.post('/chats/scan', async (c) => {
    try {
      const channels = dbExt.getChannels();
      const allChats = await chat.scanAllSessions(config.openclawDir, channels);
      
      // 保存到数据库
      allChats.forEach(ch => dbExt.saveChat(ch));
      
      return c.json({
        status: 'ok',
        chats: allChats.length,
        message: 'Chats scanned successfully',
      });
    } catch (e) {
      console.error('[API] Error scanning chats:', e);
      return c.json({ error: 'Failed to scan chats' }, 500);
    }
  });
  
  /**
   * POST /api/chats/sync - 同步 chats 表与 session 文件
   * 
   * 逻辑：
   * 1. 扫描所有 session 文件
   * 2. 文件有，表没有 → 新增（通过 scan）
   * 3. 文件没有，表有 → 删除
   */
  api.post('/chats/sync', async (c) => {
    try {
      const channels = dbExt.getChannels();
      
      // 1. 先扫描并新增缺失的 chats
      const newChats = await chat.scanAllSessions(config.openclawDir, channels);
      newChats.forEach(ch => dbExt.saveChat(ch));
      
      // 2. 删除文件不存在的 chats
      const removed = dbExt.cleanOrphanedChats(config.openclawDir);
      
      // 3. 获取最终数量
      const allChats = dbExt.getChats(undefined, 1000, 0, true);
      
      return c.json({
        status: 'ok',
        added: newChats.length,
        removed,
        total: allChats.length,
        message: `Synced: added ${newChats.length}, removed ${removed}`,
      });
    } catch (e) {
      console.error('[API] Error syncing chats:', e);
      return c.json({ error: 'Failed to sync chats' }, 500);
    }
  });
  
  // ==================== 操作追踪 ====================
  
  /**
   * GET /api/runs/:runId/operations - 获取 Run 操作列表
   */
  api.get('/runs/:runId/operations', (c) => {
    const runId = c.req.param('runId');
    
    try {
      const operations = dbExt.getOperationsByRunId(runId);
      const count = dbExt.getOperationCountByRunId(runId);
      
      return c.json({
        operations,
        summary: {
          total: operations.length,
          llmCalls: count.llm,
          toolCalls: count.tool,
        },
      });
    } catch (e) {
      console.error('[API] Error getting operations:', e);
      return c.json({ error: 'Failed to get operations' }, 500);
    }
  });
  
  // ==================== 统计信息 ====================
  
  /**
   * GET /api/stats - 获取统计信息
   */
  api.get('/stats', (c) => {
    try {
      const stats = dbExt.getDBStats();
      
      // 添加更多统计信息
      const recentRuns = db.getRuns({ limit: 10 });
      const avgDuration = recentRuns.length > 0
        ? recentRuns.reduce((sum, r) => sum + (r.completedAt || 0) - r.startedAt, 0) / recentRuns.length
        : 0;
      
      return c.json({
        ...stats,
        recentRuns: recentRuns.length,
        avgDuration: Math.round(avgDuration),
      });
    } catch (e) {
      console.error('[API] Error getting stats:', e);
      return c.json({ error: 'Failed to get stats' }, 500);
    }
  });
  
  return api;
}
