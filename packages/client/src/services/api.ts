import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
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

export async function fetchChats(channel: string, limit = 50, offset = 0) {
  const response = await api.get('/api/chats', {
    params: { channel, limit, offset }
  });
  return response.data;
}

export async function fetchMessages(chatId: string, limit = 100) {
  const response = await api.get('/api/messages', {
    params: { chat: chatId, limit }
  });
  return response.data;
}

export async function fetchOperations(messageId: string) {
  const response = await api.get('/api/operations', {
    params: { message: messageId }
  });
  return response.data;
}

// WebSocket 连接
export function createWebSocket(): WebSocket | null {
  const wsUrl = API_BASE.replace(/^http/, 'ws') + '/ws';
  
  // 如果有 Token，添加到 URL
  const url = API_TOKEN ? `${wsUrl}?token=${API_TOKEN}` : wsUrl;
  
  return new WebSocket(url);
}

export default api;