<template>
  <div class="home">
    <header class="header">
      <h1>OpenClaw Monitor</h1>
      <div class="header-actions">
        <select v-model="selectedChannel" @change="onChannelChange" class="channel-select">
          <option value="">全部渠道</option>
          <option v-for="ch in channels" :key="ch.id" :value="ch.id">{{ ch.name }}</option>
        </select>
        <select v-model="showHidden" @change="onHiddenChange" class="hidden-select">
          <option :value="false">已隐藏 ({{ hiddenCount }})</option>
          <option :value="true">显示隐藏</option>
        </select>
        <span class="status" :class="connected ? 'connected' : 'disconnected'">
          {{ connected ? '已连接' : '未连接' }}
        </span>
      </div>
    </header>
    
    <div class="main-content">
      <!-- 隐藏列表 -->
      <aside v-if="showHidden" class="sidebar hidden-sidebar">
        <div class="hidden-header">
          <h3>已隐藏的聊天 ({{ hiddenChats.length }})</h3>
          <button @click="showHidden = false" class="close-btn">✕</button>
        </div>
        <div class="hidden-list">
          <div v-for="chat in hiddenChats" :key="chat.id" class="hidden-item">
            <div class="hidden-info">
              <div class="hidden-title">{{ chat.title }}</div>
              <div class="hidden-channel">{{ chat.channelId }}</div>
            </div>
            <button @click="unhideChat(chat)" class="unhide-btn">恢复</button>
          </div>
        </div>
      </aside>
      
      <!-- 聊天列表 -->
      <aside class="sidebar">
        <ChatList :channel-id="selectedChannel" @chat-selected="onChatSelected" @chat-hidden="onChatHidden" />
      </aside>
      
      <!-- 消息详情 -->
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
import { fetchChannels, fetchHiddenChats, fetchHiddenCount, unhideChat as unhideChatApi } from '../services/api';

const channels = ref<any[]>([]);
const selectedChannel = ref('');
const selectedChat = ref<any>(null);
const connected = ref(false);
const showHidden = ref(false);
const hiddenChats = ref<any[]>([]);
const hiddenCount = ref(0);

async function loadChannels() {
  try {
    const data = await fetchChannels();
    channels.value = data.channels || [];
  } catch (error) {
    console.error('Failed to load channels:', error);
  }
}

async function loadHiddenCount() {
  try {
    const data = await fetchHiddenCount();
    hiddenCount.value = data.count || 0;
  } catch (error) {
    console.error('Failed to load hidden count:', error);
  }
}

async function loadHiddenChats() {
  try {
    const data = await fetchHiddenChats();
    hiddenChats.value = data.chats || [];
  } catch (error) {
    console.error('Failed to load hidden chats:', error);
  }
}

function onChannelChange() {
  // 清空选中的聊天
  selectedChat.value = null;
}

function onHiddenChange() {
  if (showHidden.value) {
    loadHiddenChats();
  }
}

function onChatSelected(chat: any) {
  selectedChat.value = chat;
}

async function onChatHidden() {
  // 更新隐藏数量
  await loadHiddenCount();
}

async function unhideChat(chat: any) {
  try {
    await unhideChatApi(chat.id);
    
    // 从隐藏列表移除
    hiddenChats.value = hiddenChats.value.filter(c => c.id !== chat.id);
    
    // 更新隐藏数量
    await loadHiddenCount();
  } catch (error) {
    console.error('Failed to unhide chat:', error);
  }
}

onMounted(() => {
  loadChannels();
  loadHiddenCount();
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
  gap: 12px;
}

.channel-select, .hidden-select {
  padding: 8px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 14px;
  background: #fff;
  cursor: pointer;
}

.channel-select:focus, .hidden-select:focus {
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

.hidden-sidebar {
  width: 280px;
  background: #fafafa;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
}

.hidden-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #e0e0e0;
}

.hidden-header h3 {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #999;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: #333;
}

.hidden-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.hidden-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: #fff;
  border-radius: 6px;
  margin-bottom: 8px;
}

.hidden-info {
  flex: 1;
  min-width: 0;
}

.hidden-title {
  font-size: 14px;
  font-weight: 500;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hidden-channel {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}

.unhide-btn {
  padding: 4px 12px;
  background: #1976d2;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  margin-left: 8px;
}

.unhide-btn:hover {
  background: #1565c0;
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
