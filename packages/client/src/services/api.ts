import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || '';

// 从 localStorage 或 URL 参数获取 token
function getToken(): string | null {
  // 1. 优先从 localStorage 获取
  const storedToken = localStorage.getItem('api_token');
  if (storedToken) return storedToken;
  
  // 2. 从 URL 参数获取
  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get('token');
  if (urlToken) {
    localStorage.setItem('api_token', urlToken);
    // 清除 URL 中的 token 参数（安全考虑）
    urlParams.delete('token');
    const newUrl = urlParams.toString() 
      ? `${window.location.pathname}?${urlParams.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
    return urlToken;
  }
  
  return null;
}

const api = axios.create({
  baseURL: API_BASE,
  timeout: 10000,
});

// 请求拦截器：动态添加 Token
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers['X-API-Key'] = token;
  }
  return config;
});

// 响应拦截器：处理认证错误
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token 无效，清除并提示重新输入
      localStorage.removeItem('api_token');
    }
    return Promise.reject(error);
  }
);

// 设置 Token
export function setToken(token: string) {
  localStorage.setItem('api_token', token);
}

// 获取当前 Token
export function getCurrentToken(): string | null {
  return getToken();
}

// 清除 Token
export function clearToken() {
  localStorage.removeItem('api_token');
}

// 验证 Token
export async function validateToken(token: string): Promise<boolean> {
  try {
    const response = await axios.get(`${API_BASE}/api/chats`, {
      headers: { 'X-API-Key': token }
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

export async function fetchChannels() {
  const response = await api.get('/api/channels');
  return response.data;
}

export async function fetchAccounts() {
  const response = await api.get('/api/accounts');
  return response.data;
}

export async function fetchChats(channelId?: string, limit = 50, offset = 0) {
  const response = await api.get('/api/chats', {
    params: { channelId, limit, offset }
  });
  return response.data;
}

export async function fetchMessages(chatId: string, limit = 10, offset = 0) {
  const response = await api.get(`/api/chats/${chatId}/messages`, {
    params: { limit, offset }
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
  let wsUrl: string;
  
  if (import.meta.env.VITE_WS_URL) {
    wsUrl = import.meta.env.VITE_WS_URL;
  } else if (API_BASE && API_BASE !== '') {
    const protocol = API_BASE.startsWith('https') ? 'wss:' : 'ws:';
    const host = API_BASE.replace(/^https?:\/\//, '');
    wsUrl = `${protocol}//${host}/ws`;
  } else if (typeof window !== 'undefined' && window.location.port === '5173') {
    wsUrl = 'ws://localhost:3000/ws';
  } else {
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof window !== 'undefined' ? window.location.host : 'localhost:3000';
    wsUrl = `${protocol}//${host}/ws`;
  }
  
  // 添加 Token 到 URL（使用动态获取的 token）
  const token = getToken();
  const url = token ? `${wsUrl}?token=${token}` : wsUrl;
  
  console.log('[WS] Connecting to:', url.replace(/token=[^&]+/, 'token=***'));
  
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
