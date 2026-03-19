import axios from 'axios';

// 使用相对路径，通过 vite proxy 转发（本地开发）或直接请求（生产环境）
// 如果需要直连后端，设置 VITE_API_BASE 环境变量
const API_BASE = import.meta.env.VITE_API_BASE || '';
const API_TOKEN = import.meta.env.VITE_API_TOKEN;

const api = axios.create({
  baseURL: API_BASE,
  timeout: 10000,
});

// 添加 Token 到请求头
if (API_TOKEN) {
  api.defaults.headers.common['Authorization'] = `Bearer ${API_TOKEN}`;
}

export async function fetchChannels() {
  const response = await api.get('/api/channels');
  return response.data;
}

export async function fetchChats(channelId: string, limit = 50, offset = 0) {
  const response = await api.get('/api/chats', {
    params: { channelId, limit, offset }
  });
  return response.data;
}

export async function fetchMessages(chatId: string, limit = 100) {
  const response = await api.get(`/api/chats/${chatId}/messages`, {
    params: { limit }
  });
  return response.data;
}

export async function fetchOperations(runId: string) {
  const response = await api.get(`/api/runs/${runId}/operations`);
  return response.data;
}

// 隐藏聊天相关 API
export async function hideChat(chatId: string) {
  const response = await api.post(`/api/chats/${chatId}/hide`);
  return response.data;
}

export async function unhideChat(chatId: string) {
  const response = await api.post(`/api/chats/${chatId}/unhide`);
  return response.data;
}

export async function fetchHiddenChats(limit = 50, offset = 0) {
  const response = await api.get('/api/chats/hidden', {
    params: { limit, offset }
  });
  return response.data;
}

export async function fetchHiddenCount() {
  const response = await api.get('/api/chats/hidden/count');
  return response.data;
}

// WebSocket 连接
export function createWebSocket(onMessage?: (data: any) => void): WebSocket | null {
  // WebSocket 连接地址优先级：
  // 1. VITE_WS_URL 环境变量（完整 URL，如 ws://192.168.1.100:3000/ws）
  // 2. VITE_API_BASE 环境变量的 host（如 http://192.168.1.100:3000 → ws://192.168.1.100:3000/ws）
  // 3. 开发模式默认 localhost:3000
  // 4. 生产模式使用当前页面 host
  
  let wsUrl: string;
  
  if (import.meta.env.VITE_WS_URL) {
    // 方式1：直接配置 WebSocket URL
    wsUrl = import.meta.env.VITE_WS_URL;
  } else if (API_BASE && API_BASE !== '') {
    // 方式2：从 API_BASE 推导
    const protocol = API_BASE.startsWith('https') ? 'wss:' : 'ws:';
    const host = API_BASE.replace(/^https?:\/\//, '');
    wsUrl = `${protocol}//${host}/ws`;
  } else if (typeof window !== 'undefined' && window.location.port === '5173') {
    // 方式3：开发模式默认
    wsUrl = 'ws://localhost:3000/ws';
  } else {
    // 方式4：生产模式使用当前 host
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof window !== 'undefined' ? window.location.host : 'localhost:3000';
    wsUrl = `${protocol}//${host}/ws`;
  }
  
  console.log('[WS] Connecting to:', wsUrl);
  
  // 如果有 Token，添加到 URL
  const url = API_TOKEN ? `${wsUrl}?token=${API_TOKEN}` : wsUrl;
  
  const ws = new WebSocket(url);
  
  if (onMessage) {
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };
  }
  
  return ws;
}

export default api;