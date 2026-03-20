import type { Run, WSMessage } from '../types';
import * as db from '../db';

// ✅ 安全：认证配置
const API_KEY = process.env.API_KEY;

// WebSocket 类型定义
type WebSocketType = WebSocket & {
  readyState: number;
  send: (data: string) => void;
  ping?: () => void;
  pong?: () => void;
  on?: (event: string, listener: (...args: any[]) => void) => void;
  terminate?: () => void;
};

const WebSocketOPEN = 1;

// 连接管理
const connections = new Map<WebSocketType, {
  lastPong: number;
}>();

// ✅ 心跳配置
const HEARTBEAT_INTERVAL = 30000;  // 30秒
const HEARTBEAT_TIMEOUT = 60000;   // 60秒超时
const MAX_CONNECTIONS = 100;       // 最大连接数

// ✅ 全局心跳定时器（一个定时器管理所有连接）
let heartbeatTimer: NodeJS.Timeout | null = null;

/**
 * ✅ 优化：启动全局心跳检测
 */
function startGlobalHeartbeat(): void {
  if (heartbeatTimer) return;  // 防止重复启动
  
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    const deadConnections: WebSocketType[] = [];
    
    for (const [ws, info] of connections) {
      // 检查超时
      if (now - info.lastPong > HEARTBEAT_TIMEOUT) {
        deadConnections.push(ws);
        continue;
      }
      
      // 发送 ping
      try {
        if (ws.readyState === WebSocketOPEN) {
          ws.ping?.();
        }
      } catch (e) {
        deadConnections.push(ws);
      }
    }
    
    // 清理死连接
    for (const ws of deadConnections) {
      console.warn('[WS] Connection timeout or error, terminating');
      ws.terminate?.();
      removeConnection(ws);
    }
  }, HEARTBEAT_INTERVAL);
  
  console.log('[WS] Global heartbeat started');
}

/**
 * 停止全局心跳
 */
function stopGlobalHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log('[WS] Global heartbeat stopped');
  }
}

/**
 * 广播消息到所有连接
 */
export function broadcast(type: WSMessage['type'], data: Run): number {
  // 使用原子操作保存消息
  const seq = db.saveWSMessageAtomic(type, data);
  const message: WSMessage = { type, data, seq };
  
  // 推送到所有连接
  const messageStr = JSON.stringify(message);
  const failedConnections: WebSocketType[] = [];
  
  console.log(`[WS] Broadcasting to ${connections.size} connections: ${type}`);
  
  for (const [ws] of connections) {
    try {
      if (ws.readyState === WebSocketOPEN) {
        ws.send(messageStr);
        console.log(`[WS] Sent message to connection, seq=${seq}`);
      } else {
        console.log(`[WS] Connection not open, readyState=${ws.readyState}`);
        failedConnections.push(ws);
      }
    } catch (e) {
      console.error('[WS] Failed to send:', e);
      failedConnections.push(ws);
    }
  }
  
  // 清理失败连接
  for (const ws of failedConnections) {
    removeConnection(ws);
  }
  
  return seq;
}

/**
 * 发送消息到特定连接
 */
export function sendTo(ws: WebSocketType, type: WSMessage['type'], data: Run): number {
  // 使用原子操作保存消息
  const seq = db.saveWSMessageAtomic(type, data);
  const message: WSMessage = { type, data, seq };
  
  // 发送
  try {
    if (ws.readyState === WebSocketOPEN) {
      ws.send(JSON.stringify(message));
    }
  } catch (e) {
    console.error('[WS] Failed to send:', e);
    removeConnection(ws);
  }
  
  return seq;
}

/**
 * 重发未确认消息
 */
export function resendUnacked(ws: WebSocketType, sinceSeq?: number): void {
  const messages = db.getUnackedMessages(sinceSeq);
  
  for (const msg of messages) {
    const message: WSMessage = {
      type: msg.type as WSMessage['type'],
      data: msg.data as Run,
      seq: msg.seq,
    };
    
    try {
      if (ws.readyState === WebSocketOPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (e) {
      console.error('[WS] Failed to resend:', e);
      return;
    }
  }
}

/**
 * 处理客户端消息
 */
export function handleClientMessage(ws: WebSocketType, data: any): void {
  try {
    const parsed = JSON.parse(data.toString());
    
    // ACK 确认
    if (parsed.type === 'ack' && typeof parsed.seq === 'number') {
      db.ackMessage(parsed.seq);
    }
    
    // 批量 ACK
    if (parsed.type === 'ack_batch' && Array.isArray(parsed.seqs)) {
      db.ackMessagesBatch(parsed.seqs);
    }
    
    // 重连请求
    if (parsed.type === 'reconnect' && typeof parsed.lastSeq === 'number') {
      resendUnacked(ws, parsed.lastSeq);
    }
    
    // pong 响应（客户端主动回复）
    if (parsed.type === 'pong') {
      const info = connections.get(ws);
      if (info) {
        info.lastPong = Date.now();
      }
    }
  } catch (e) {
    console.error('[WS] Failed to handle message:', e);
  }
}

/**
 * 添加连接
 */
export function addConnection(ws: WebSocketType): void {
  // 连接数限制
  if (connections.size >= MAX_CONNECTIONS) {
    console.warn('[WS] Max connections reached, rejecting');
    ws.send(JSON.stringify({ type: 'error', message: 'Max connections reached' }));
    ws.terminate?.();
    return;
  }
  
  const now = Date.now();
  connections.set(ws, { lastPong: now });
  
  // 监听 pong（客户端响应心跳）
  ws.on?.('pong', () => {
    const info = connections.get(ws);
    if (info) {
      info.lastPong = Date.now();
    }
  });
  
  // 监听 close
  ws.on?.('close', () => {
    removeConnection(ws);
  });
  
  // 监听 error
  ws.on?.('error', (err: Error) => {
    console.error('[WS] Connection error:', err);
    removeConnection(ws);
  });
  
  // 确保全局心跳已启动
  if (!heartbeatTimer) {
    startGlobalHeartbeat();
  }
  
  console.log(`[WS] Connection added, total: ${connections.size}`);
  
  // 发送连接成功消息
  try {
    ws.send(JSON.stringify({ 
      type: 'connected', 
      timestamp: now,
      heartbeatInterval: HEARTBEAT_INTERVAL,
    }));
  } catch (e) {
    console.error('[WS] Failed to send connected message:', e);
  }
}

/**
 * 移除连接
 */
export function removeConnection(ws: WebSocketType): void {
  connections.delete(ws);
  console.log(`[WS] Connection removed, total: ${connections.size}`);
}

/**
 * 获取连接数
 */
export function getConnectionCount(): number {
  return connections.size;
}

/**
 * 清理所有死连接
 */
export function cleanupDeadConnections(): number {
  const now = Date.now();
  const deadConnections: WebSocketType[] = [];
  
  for (const [ws, info] of connections) {
    if (now - info.lastPong > HEARTBEAT_TIMEOUT || ws.readyState !== WebSocketOPEN) {
      deadConnections.push(ws);
    }
  }
  
  for (const ws of deadConnections) {
    removeConnection(ws);
  }
  
  if (deadConnections.length > 0) {
    console.log(`[WS] Cleaned up ${deadConnections.length} dead connections`);
  }
  
  return deadConnections.length;
}

/**
 * ✅ 安全：WebSocket 路由处理器（带 token 认证）
 */
export function createWSHandler(token: string | null) {
  return {
    onOpen: (event: Event, ws: any) => {
      // ✅ 安全：验证 token（如果配置了 API_KEY）
      if (API_KEY) {
        if (token !== API_KEY) {
          console.log('[WS] Unauthorized connection attempt, token:', token?.substring(0, 8) + '...');
          ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
          ws.terminate?.();
          return;
        }
      }
      
      console.log('[WS] Connection authorized');
      addConnection(ws);
    },
    
    onClose: (event: any, ws: any) => {
      removeConnection(ws);
    },
    
    onMessage: (event: any, ws: any) => {
      handleClientMessage(ws, event.data);
    },
    
    onError: (event: Event, ws: any) => {
      console.error('[WS] Error:', event);
      removeConnection(ws);
    },
  };
}

/**
 * 定期清理任务
 */
let cleanupTimer: NodeJS.Timeout | null = null;

export function startPeriodicCleanup(intervalMs: number = 60000): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }
  
  cleanupTimer = setInterval(() => {
    cleanupDeadConnections();
    db.cleanupOldMessages();
  }, intervalMs);
  
  console.log(`[WS] Periodic cleanup started, interval: ${intervalMs}ms`);
}

export function stopPeriodicCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  
  // 同时停止全局心跳
  stopGlobalHeartbeat();
}
