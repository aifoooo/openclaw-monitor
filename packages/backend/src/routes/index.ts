import express from 'express';
import cors from 'cors';
import type { Chat, Message } from '../types';
import { parseAllSessions, parseSessionMessages } from '../parser';
import { enrichWithProxyLog } from '../parser/proxy-log';

const router = express.Router();

// 缓存
let chatsCache: Chat[] = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 5000; // 5秒缓存

// 更新缓存
async function updateCache() {
  const now = Date.now();
  if (now - lastCacheUpdate > CACHE_TTL) {
    chatsCache = await parseAllSessions();
    lastCacheUpdate = now;
  }
}

// 获取渠道列表
router.get('/channels', async (req, res) => {
  try {
    await updateCache();
    
    // 从聊天列表提取渠道
    const channelMap = new Map<string, { id: string; name: string; type: string }>();
    
    for (const chat of chatsCache) {
      if (!channelMap.has(chat.channelId)) {
        channelMap.set(chat.channelId, {
          id: chat.channelId,
          name: chat.channelId, // 可以从配置读取更友好的名称
          type: chat.channelId.includes('qq') ? 'qqbot' : 'unknown',
        });
      }
    }
    
    const channels = Array.from(channelMap.values()).map(ch => ({
      ...ch,
      status: 'online' as const,
    }));
    
    res.json({ channels });
  } catch (error) {
    console.error('Failed to get channels:', error);
    res.status(500).json({ error: 'Failed to get channels' });
  }
});

// 获取聊天列表
router.get('/chats', async (req, res) => {
  try {
    const { channel, limit = 50, offset = 0 } = req.query;
    
    await updateCache();
    
    let filtered = chatsCache;
    if (channel) {
      filtered = chatsCache.filter(c => c.channelId === channel);
    }
    
    const total = filtered.length;
    const chats = filtered.slice(Number(offset), Number(offset) + Number(limit));
    
    res.json({ chats, total });
  } catch (error) {
    console.error('Failed to get chats:', error);
    res.status(500).json({ error: 'Failed to get chats' });
  }
});

// 获取消息列表
router.get('/messages', async (req, res) => {
  try {
    const { chat: chatId, limit = 100 } = req.query;
    
    if (!chatId) {
      return res.status(400).json({ error: 'Missing chat parameter' });
    }
    
    // 找到对应的 session 文件
    const chat = chatsCache.find(c => c.id === chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    const messages = parseSessionMessages(chat.sessionFile);
    
    // 合并代理日志
    const enrichedMessages = messages.map(msg => enrichWithProxyLog(msg));
    
    res.json({ messages: enrichedMessages.slice(0, Number(limit)) });
  } catch (error) {
    console.error('Failed to get messages:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// 获取操作详情
router.get('/operations', async (req, res) => {
  try {
    const { message: messageId } = req.query;
    
    if (!messageId) {
      return res.status(400).json({ error: 'Missing message parameter' });
    }
    
    // 从消息 ID 提取 chatId 和 index
    // messageId 格式: msg-{index}
    // 需要从缓存中找到对应的消息
    
    // 简化实现：遍历所有聊天找到对应消息
    await updateCache();
    
    for (const chat of chatsCache) {
      const messages = parseSessionMessages(chat.sessionFile);
      const msg = messages.find(m => m.id === messageId);
      
      if (msg && msg.operations) {
        return res.json({ operations: msg.operations });
      }
    }
    
    res.json({ operations: [] });
  } catch (error) {
    console.error('Failed to get operations:', error);
    res.status(500).json({ error: 'Failed to get operations' });
  }
});

export default router;
