<template>
  <div class="home">
    <header class="header">
      <h1>OpenClaw Monitor</h1>
      <div class="header-actions">
        <select v-model="selectedChannel" @change="onChannelChange">
          <option value="">选择渠道</option>
          <option v-for="ch in channels" :key="ch.id" :value="ch.id">{{ ch.name }}</option>
        </select>
      </div>
    </header>
    
    <div class="main-content">
      <aside class="sidebar">
        <ChatList @chat-selected="onChatSelected" />
      </aside>
      
      <main class="content">
        <MessageDetail v-if="selectedChat" :chat-id="selectedChat.id" />
        <div v-else class="placeholder">
          选择一个聊天查看详情
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import ChatList from '../components/ChatList.vue';
import MessageDetail from '../components/MessageDetail.vue';
import { fetchChannels } from '../services/api';

const channels = ref<any[]>([]);
const selectedChannel = ref('');
const selectedChat = ref<any>(null);

async function loadChannels() {
  try {
    const data = await fetchChannels();
    channels.value = data.channels || [];
  } catch (error) {
    console.error('Failed to load channels:', error);
  }
}

function onChannelChange() {
  // 通知 ChatList 重新加载
}

function onChatSelected(chat: any) {
  selectedChat.value = chat;
}

onMounted(() => {
  loadChannels();
});
</script>

<style scoped>
.home {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
  border-bottom: 1px solid #e0e0e0;
}

.header h1 {
  font-size: 24px;
  color: #333;
}

.header-actions select {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sidebar {
  width: 300px;
  border-right: 1px solid #e0e0e0;
  overflow-y: auto;
}

.content {
  flex: 1;
  overflow-y: auto;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
  font-size: 16px;
}
</style>