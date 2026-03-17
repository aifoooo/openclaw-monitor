import type { Run, WSMessage } from '../types';
import * as db from '../db';

// WebSocket 类型定义
type WebSocketType = WebSocket & {
  readyState: number;
  send: (data: string) => void;
};

const WebSocketOPEN = 1;

// 连接管理
const connections = new Set<WebSocketType>();

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
  
  for (const ws of connections) {
    try {
      if (ws.readyState === WebSocketOPEN) {
        ws.send(messageStr);
      }
    } catch (e) {
      console.error('[WS] Failed to send:', e);
      failedConnections.push(ws);
    }
  }
  
  // 清理失败连接
  for (const ws of failedConnections) {
    connections.delete(ws);
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
    
    if (ws.readyState === WebSocketOPEN) {
      ws.send(JSON.stringify(message));
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
  } catch (e) {
    console.error('[WS] Failed to handle message:', e);
  }
}

/**
 * 添加连接
 */
export function addConnection(ws: WebSocketType): void {
  connections.add(ws);
  console.log(`[WS] Connection added, total: ${connections.size}`);
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
 * WebSocket 路由处理器（用于 Hono）
 */
export function createWSHandler() {
  return {
    onOpen: (event: Event, ws: any) => {
      addConnection(ws);
      
      // 发送连接成功消息
      ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
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
