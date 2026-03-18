<template>
  <div class="chat-list">
    <div class="header">
      <h2>聊天列表</h2>
      <span class="count">{{ chats.length }} 个会话</span>
    </div>
    
    <div class="search">
      <input v-model="searchQuery" placeholder="搜索聊天..." />
    </div>
    
    <div class="chat-items">
      <div v-if="loading" class="loading">加载中...</div>
      <div v-else-if="filteredChats.length === 0" class="empty">暂无聊天</div>
      <div v-else v-for="chat in filteredChats" :key="chat.id" 
           class="chat-item" 
           :class="{ active: selectedChatId === chat.id }"
           @click="selectChat(chat)">
        <div class="chat-title">{{ chat.title || chat.sessionKey }}</div>
        <div class="chat-meta">
          <span class="channel">{{ chat.channelId }}</span>
          <span class="time">{{ formatTime(chat.lastMessageAt) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { fetchChats } from '../services/api';
import { debounce } from '../utils/performance';

interface Chat {
  id: string;
  channelId: string;
  accountId: string;
  title: string;
  sessionKey: string;
  lastMessageAt: number;
  messageCount: number;
}

const chats = ref<Chat[]>([]);
const searchQuery = ref('');
const selectedChatId = ref<string>('');
const loading = ref(false);

const filteredChats = computed(() => {
  let result = chats.value;
  
  // 搜索过滤
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(chat => 
      (chat.title && chat.title.toLowerCase().includes(query)) ||
      (chat.sessionKey && chat.sessionKey.toLowerCase().includes(query)) ||
      (chat.channelId && chat.channelId.toLowerCase().includes(query))
    );
  }
  
  // 按最后活跃时间排序
  return result.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
});

async function loadChats() {
  loading.value = true;
  try {
    // 不传 channelId，加载所有聊天
    const data = await fetchChats();
    chats.value = data.chats || [];
  } catch (error) {
    console.error('Failed to load chats:', error);
  } finally {
    loading.value = false;
  }
}

// 防抖搜索
const debouncedSearch = debounce((query: string) => {
  console.log('Searching:', query);
}, 300);

watch(searchQuery, (newQuery) => {
  debouncedSearch(newQuery);
});

function selectChat(chat: Chat) {
  selectedChatId.value = chat.id;
  emit('chat-selected', chat);
}

function formatTime(timestamp: number) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - timestamp;
  
  // 今天内显示时间
  if (diff < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  // 一周内显示星期
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return days[date.getDay()];
  }
  // 其他显示日期
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

const emit = defineEmits<{
  (e: 'chat-selected', chat: Chat): void;
}>();

onMounted(() => {
  loadChats();
});
</script>

<style scoped>
.chat-list {
  padding: 16px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.header h2 {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.count {
  font-size: 12px;
  color: #999;
}

.search {
  margin-bottom: 12px;
}

.search input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.2s;
}

.search input:focus {
  outline: none;
  border-color: #1976d2;
}

.chat-items {
  flex: 1;
  overflow-y: auto;
  will-change: transform;
  -webkit-overflow-scrolling: touch;
}

.loading, .empty {
  text-align: center;
  padding: 24px;
  color: #999;
}

.chat-item {
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.chat-item:hover {
  background-color: #f5f5f5;
}

.chat-item.active {
  background-color: #e3f2fd;
}

.chat-title {
  font-weight: 500;
  margin-bottom: 6px;
  color: #333;
  font-size: 14px;
}

.chat-meta {
  font-size: 12px;
  color: #999;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.channel {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}
</style>
