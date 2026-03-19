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
export function createWebSocket(): WebSocket | null {
  const wsUrl = API_BASE.replace(/^http/, 'ws') + '/ws';
  
  // 如果有 Token，添加到 URL
  const url = API_TOKEN ? `${wsUrl}?token=${API_TOKEN}` : wsUrl;
  
  return new WebSocket(url);
}

export default api;