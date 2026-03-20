<template>
  <div class="app-container">
    <!-- Header -->
    <header class="app-header">
      <h1 class="app-title">OpenClaw Monitor</h1>
      <div class="header-actions">
        <select v-model="selectedAccount" @change="onAccountChange" class="header-select">
          <option value="">全部账号</option>
          <option v-for="acc in accounts" :key="`${acc.channelId}:${acc.accountId}`" 
                  :value="`${acc.channelId}:${acc.accountId}`">
            {{ acc.channelName }} - {{ acc.accountName }}
          </option>
        </select>
        <span class="status-dot" :class="connected ? 'online' : 'offline'"></span>
        <span class="status-text">{{ connected ? '已连接' : '未连接' }}</span>
      </div>
    </header>

    <!-- Main Content -->
    <main class="app-main">
      <!-- Chat List Sidebar -->
      <aside class="sidebar-chat">
        <ChatList ref="chatListRef" :account-filter="selectedAccount" @chat-selected="onChatSelected" />
      </aside>

      <!-- Message Detail -->
      <section class="content-area">
        <MessageDetail 
          v-if="selectedChat" 
          ref="messageDetailRef"
          :chat-id="selectedChat.id" 
          :session-file="selectedChat.sessionFile" 
        />
        <div v-else class="empty-placeholder">
          <div class="empty-icon">💬</div>
          <div class="empty-text">选择一个聊天查看详情</div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import ChatList from '../components/ChatList.vue';
import MessageDetail from '../components/MessageDetail.vue';
import { fetchAccounts, createWebSocket } from '../services/api';

interface Account {
  channelId: string;
  accountId: string;
  channelName: string;
  accountName: string;
  chatCount: number;
  lastActivity: number | null;
}

const accounts = ref<Account[]>([]);
const selectedAccount = ref('');
const selectedChat = ref<any>(null);
const connected = ref(false);
const chatListRef = ref<{ 
  refresh: () => void; 
  updateChat: (id: string, updates: any) => void;
  updateBySessionFile: (sessionFile: string, updates: any) => void;
  selectFirst: () => void;
} | null>(null);
const messageDetailRef = ref<{ refresh: () => void; appendMessage: (msg: any) => void } | null>(null);
let ws: WebSocket | null = null;

async function loadAccounts() {
  try {
    const data = await fetchAccounts();
    accounts.value = data.accounts || [];
  } catch (error) {
    console.error('Failed to load accounts:', error);
  }
}

function onAccountChange() {
  // ✅ 保存选择到 localStorage
  localStorage.setItem('openclaw-monitor-selected-account', selectedAccount.value);
  
  // ✅ 自动选中第一个聊天
  nextTick(() => {
    if (chatListRef.value) {
      chatListRef.value.selectFirst();
    }
  });
}

function onChatSelected(chat: any) {
  selectedChat.value = chat;
}

function handleWebSocketMessage(data: any) {
  if (data.type === 'new_message' && data.data) {
    const sessionFile = data.data.file;
    const message = data.data.message;
    
    // ✅ 提取消息实际时间戳
    let messageTime = Date.now();
    if (message) {
      const msg = message.message || message;
      if (msg.timestamp) {
        messageTime = typeof msg.timestamp === 'number' ? msg.timestamp : new Date(msg.timestamp).getTime();
      } else if (message.timestamp) {
        messageTime = typeof message.timestamp === 'number' ? message.timestamp : new Date(message.timestamp).getTime();
      }
    }
    
    // ✅ 更新聊天列表时间
    if (chatListRef.value && sessionFile) {
      chatListRef.value.updateBySessionFile(sessionFile, { lastMessageAt: messageTime });
    }
    
    // ✅ 追加消息到详情页
    if (selectedChat.value && messageDetailRef.value && sessionFile) {
      if (selectedChat.value.sessionFile === sessionFile && message) {
        const msg = message.message || message;
        messageDetailRef.value.appendMessage({
          id: message.id || `msg-${Date.now()}`,
          role: msg.role || 'user',
          content: msg.content || '',
          timestamp: messageTime,
        });
      }
    }
  }
}

function connectWebSocket() {
  ws = createWebSocket(handleWebSocketMessage);
  if (ws) {
    ws.onopen = () => {
      connected.value = true;
      // 发送心跳包
      const heartbeat = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000); // 每30秒发送一次心跳
      // 存储心跳定时器
      (ws as any)._heartbeat = heartbeat;
    };
    ws.onclose = () => { 
      connected.value = false;
      // 清除心跳
      if ((ws as any)._heartbeat) {
        clearInterval((ws as any)._heartbeat);
      }
      setTimeout(() => { if (!ws || ws.readyState === WebSocket.CLOSED) connectWebSocket(); }, 5000);
    };
    ws.onerror = (error) => { console.error('[WS] Error:', error); };
  }
}

onMounted(() => {
  loadAccounts();
  connectWebSocket();
  
  // ✅ 从 localStorage 恢复上次选择的账号
  const savedAccount = localStorage.getItem('openclaw-monitor-selected-account');
  if (savedAccount) {
    selectedAccount.value = savedAccount;
  }
  
  // ✅ 自动选中第一个聊天
  nextTick(() => {
    if (chatListRef.value) {
      chatListRef.value.selectFirst();
    }
  });
});

onUnmounted(() => {
  if (ws) { ws.close(); ws = null; }
});
</script>

<style scoped>
/* ==================== QQ 风格布局 ==================== */
/* 外圆内方，无间隙 */

.app-container {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  background: oklch(99% 0.002 250);
  
  /* 最外层圆角 */
  border-radius: 12px;
  overflow: hidden;
  
  /* 细微边框 */
  border: 1px solid oklch(88% 0.005 250);
  
  /* 阴影 */
  box-shadow: 
    0 2px 8px oklch(0% 0 0 / 0.06),
    0 8px 24px oklch(0% 0 0 / 0.04);
}

/* ==================== Header ==================== */
.app-header {
  height: 56px;
  padding: 0 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: oklch(99% 0.002 250);
  border-bottom: 1px solid oklch(92% 0.005 250);
  
  /* 顶部无圆角 */
  border-radius: 0;
}

.app-title {
  font-size: 16px;
  font-weight: 700;
  color: oklch(20% 0.02 250);
  letter-spacing: -0.02em;
  margin: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-select {
  padding: 6px 32px 6px 12px;
  border: 1px solid oklch(88% 0.005 250);
  border-radius: 6px;
  font-size: 13px;
  background: oklch(99% 0.002 250);
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
}

.header-select:hover {
  border-color: oklch(75% 0.01 250);
}

.header-select:focus {
  outline: none;
  border-color: oklch(55% 0.18 250);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.online {
  background: oklch(65% 0.15 150);
}

.status-dot.offline {
  background: oklch(60% 0.15 25);
}

.status-text {
  font-size: 12px;
  color: oklch(50% 0.01 250);
  margin-left: -4px;
}

/* ==================== Main Content ==================== */
.app-main {
  display: flex;
  flex: 1;
  overflow: hidden;
  
  /* 无间隙 */
  gap: 0;
}

/* ==================== Sidebar Chat ==================== */
.sidebar-chat {
  width: 280px;
  min-width: 240px;
  max-width: 320px;
  background: oklch(99% 0.002 250);
  border-right: 1px solid oklch(92% 0.005 250);
  
  /* 内部无圆角 */
  border-radius: 0;
  overflow: hidden;
}

/* ==================== Content Area ==================== */
.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: oklch(97% 0.005 250);
  
  /* 内部无圆角 */
  border-radius: 0;
  overflow: hidden;
}

.empty-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: oklch(50% 0.01 250);
}

.empty-icon {
  font-size: 48px;
  opacity: 0.3;
  margin-bottom: 12px;
}

.empty-text {
  font-size: 14px;
  font-weight: 500;
}
</style>
