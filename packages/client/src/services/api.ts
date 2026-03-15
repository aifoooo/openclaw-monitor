import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 10000,
});

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

export default api;