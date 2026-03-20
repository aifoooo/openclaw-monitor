<template>
  <div class="chat-list">
    <!-- Header -->
    <div class="chat-list-header">
      <h2>聊天列表</h2>
      <span class="chat-count">{{ filteredChats.length }}</span>
    </div>

    <!-- Search -->
    <div class="chat-search">
      <input 
        v-model="searchQuery"
        type="text"
        placeholder="搜索聊天..."
      />
    </div>

    <!-- Chat Items -->
    <div class="chat-items">
      <div v-if="loading" class="loading-state">
        <div class="skeleton-item"></div>
        <div class="skeleton-item"></div>
        <div class="skeleton-item"></div>
      </div>
      
      <div v-else-if="filteredChats.length === 0" class="empty-state">
        没有找到聊天
      </div>
      
      <div 
        v-else
        v-for="chat in filteredChats" 
        :key="chat.id"
        class="chat-item"
        :class="{ active: selectedChatId === chat.id }"
        @click="selectChat(chat)"
      >
        <div class="chat-item-title">{{ chat.title }}</div>
        <div class="chat-item-meta">
          <span class="chat-channel">{{ chat.channelId }}</span>
          <span class="chat-time">{{ formatTime(chat.lastMessageAt) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { fetchChats } from '../services/api';

interface Chat {
  id: string;
  chatId: string;
  channelId: string;
  accountId: string;
  sessionKey: string;
  title: string;
  lastMessageAt: number;
  messageCount: number;
  sessionFile: string;
}

const props = defineProps<{
  accountFilter?: string;
}>();

const chats = ref<Chat[]>([]);
const searchQuery = ref('');
const selectedChatId = ref<string>('');
const loading = ref(false);

const filteredChats = computed(() => {
  let result = chats.value;
  
  if (props.accountFilter) {
    const [channelId, accountId] = props.accountFilter.split(':');
    result = result.filter(chat => 
      chat.channelId === channelId && chat.accountId === accountId
    );
  }
  
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(chat => 
      (chat.title && chat.title.toLowerCase().includes(query)) ||
      (chat.sessionKey && chat.sessionKey.toLowerCase().includes(query))
    );
  }
  
  return result.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
});

async function loadChats() {
  loading.value = true;
  try {
    const data = await fetchChats();
    chats.value = data.chats || [];
  } catch (error) {
    console.error('Failed to load chats:', error);
  } finally {
    loading.value = false;
  }
}

function updateChat(chatId: string, updates: Partial<Chat>) {
  const index = chats.value.findIndex(c => c.id === chatId);
  if (index !== -1) {
    chats.value[index] = { ...chats.value[index], ...updates };
  }
}

function updateBySessionFile(sessionFile: string, updates: Partial<Chat>) {
  const index = chats.value.findIndex(c => c.sessionFile === sessionFile);
  if (index !== -1) {
    chats.value[index] = { ...chats.value[index], ...updates };
  }
}

defineExpose({
  refresh: loadChats,
  updateChat,
  updateBySessionFile,
});

function selectChat(chat: Chat) {
  selectedChatId.value = chat.id;
  emit('chat-selected', chat);
}

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

const emit = defineEmits<{
  (e: 'chat-selected', chat: Chat | null): void;
}>();

onMounted(() => {
  loadChats();
});
</script>

<style scoped>
/* ==================== QQ 风格聊天列表 ==================== */
/* 无圆角，紧凑布局 */

.chat-list {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  background: oklch(99% 0.002 250);
}

/* Header */
.chat-list-header {
  height: 48px;
  padding: 0 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: oklch(99% 0.002 250);
  border-bottom: 1px solid oklch(92% 0.005 250);
  
  /* 无圆角 */
  border-radius: 0;
}

.chat-list-header h2 {
  font-size: 14px;
  font-weight: 600;
  color: oklch(25% 0.02 250);
  margin: 0;
}

.chat-count {
  font-size: 11px;
  font-weight: 600;
  color: oklch(50% 0.01 250);
  background: oklch(94% 0.005 250);
  padding: 2px 8px;
  border-radius: 10px;
}

/* Search */
.chat-search {
  padding: 8px 12px;
  border-bottom: 1px solid oklch(92% 0.005 250);
}

.chat-search input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid oklch(88% 0.005 250);
  border-radius: 4px;
  font-size: 13px;
  background: oklch(97% 0.003 250);
}

.chat-search input:focus {
  outline: none;
  border-color: oklch(55% 0.18 250);
  background: oklch(99% 0.002 250);
}

/* Chat Items */
.chat-items {
  flex: 1;
  overflow-y: auto;
}

.chat-item {
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid oklch(94% 0.005 250);
  transition: background 0.15s ease;
}

.chat-item:hover {
  background: oklch(97% 0.005 250);
}

.chat-item.active {
  background: oklch(96% 0.03 250);
}

.chat-item-title {
  font-size: 13px;
  font-weight: 500;
  color: oklch(25% 0.02 250);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-item-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chat-channel {
  font-size: 11px;
  color: oklch(50% 0.01 250);
  background: oklch(94% 0.005 250);
  padding: 2px 6px;
  border-radius: 2px;
}

.chat-time {
  font-size: 11px;
  color: oklch(50% 0.01 250);
}

/* Loading & Empty */
.loading-state {
  padding: 12px;
}

.skeleton-item {
  height: 56px;
  background: oklch(96% 0.005 250);
  margin-bottom: 8px;
  border-radius: 0;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 0.3; }
}

.empty-state {
  text-align: center;
  padding: 32px;
  color: oklch(50% 0.01 250);
  font-size: 13px;
}
</style>
