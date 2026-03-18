<template>
  <div class="home">
    <header class="header">
      <h1>OpenClaw Monitor</h1>
      <div class="header-actions">
        <select v-model="selectedChannel" @change="onChannelChange" class="channel-select">
          <option value="">全部渠道</option>
          <option v-for="ch in channels" :key="ch.id" :value="ch.id">{{ ch.name }}</option>
        </select>
        <span class="status" :class="connected ? 'connected' : 'disconnected'">
          {{ connected ? '已连接' : '未连接' }}
        </span>
      </div>
    </header>
    
    <div class="main-content">
      <aside class="sidebar">
        <ChatList :channel-id="selectedChannel" @chat-selected="onChatSelected" />
      </aside>
      
      <main class="content">
        <MessageDetail v-if="selectedChat" :chat-id="selectedChat.id" :session-file="selectedChat.sessionFile" />
        <div v-else class="placeholder">
          <div class="placeholder-icon">💬</div>
          <div class="placeholder-text">选择一个聊天查看详情</div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import ChatList from '../components/ChatList.vue';
import MessageDetail from '../components/MessageDetail.vue';
import { fetchChannels } from '../services/api';

const channels = ref<any[]>([]);
const selectedChannel = ref('');
const selectedChat = ref<any>(null);
const connected = ref(false);

async function loadChannels() {
  try {
    const data = await fetchChannels();
    channels.value = data.channels || [];
  } catch (error) {
    console.error('Failed to load channels:', error);
  }
}

function onChannelChange() {
  // 清空选中的聊天
  selectedChat.value = null;
}

function onChatSelected(chat: any) {
  selectedChat.value = chat;
}

onMounted(() => {
  loadChannels();
  connected.value = true;
});

onUnmounted(() => {
  // 清理
});
</script>

<style scoped>
.home {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #fafafa;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: #fff;
  border-bottom: 1px solid #e0e0e0;
}

.header h1 {
  font-size: 20px;
  font-weight: 600;
  color: #333;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.channel-select {
  padding: 8px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 14px;
  background: #fff;
  cursor: pointer;
}

.channel-select:focus {
  outline: none;
  border-color: #1976d2;
}

.status {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
}

.status.connected {
  background: #e8f5e9;
  color: #2e7d32;
}

.status.disconnected {
  background: #ffebee;
  color: #c62828;
}

.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sidebar {
  width: 320px;
  background: #fff;
  border-right: 1px solid #e0e0e0;
}

.content {
  flex: 1;
  overflow-y: auto;
  background: #fff;
}

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
}

.placeholder-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.placeholder-text {
  font-size: 16px;
}
</style>
