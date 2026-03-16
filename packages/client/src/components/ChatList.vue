<template>
  <div class="chat-list">
    <div class="header">
      <h2>聊天列表</h2>
      <select v-model="selectedChannel" @change="loadChats">
        <option v-for="channel in channels" :key="channel.id" :value="channel.id">
          {{ channel.name }}
        </option>
      </select>
    </div>
    
    <div class="search">
      <input v-model="searchQuery" placeholder="搜索聊天..." />
    </div>
    
    <div class="chat-items">
      <div v-for="chat in filteredChats" :key="chat.id" 
           class="chat-item" @click="selectChat(chat)">
        <div class="chat-title">{{ chat.title }}</div>
        <div class="chat-meta">
          <span>{{ formatTime(chat.lastMessageAt) }}</span>
          <span>{{ chat.messageCount }} 条消息</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import axios from 'axios';
import { debounce } from '../utils/performance';

interface Channel {
  id: string;
  name: string;
  type: string;
  status: string;
}

interface Chat {
  id: string;
  channelId: string;
  title: string;
  lastMessageAt: number;
  messageCount: number;
}

const channels = ref<Channel[]>([]);
const chats = ref<Chat[]>([]);
const selectedChannel = ref('');
const searchQuery = ref('');
const selectedChat = ref<Chat | null>(null);

const filteredChats = computed(() => {
  if (!searchQuery.value) return chats.value;
  return chats.value.filter(chat => 
    chat.title.toLowerCase().includes(searchQuery.value.toLowerCase())
  );
});

async function loadChannels() {
  try {
    const response = await axios.get('/api/channels');
    channels.value = response.data.channels;
    if (channels.value.length > 0) {
      selectedChannel.value = channels.value[0].id;
      loadChats();
    }
  } catch (error) {
    console.error('Failed to load channels:', error);
  }
}

async function loadChats() {
  if (!selectedChannel.value) return;
  
  try {
    const response = await axios.get(`/api/chats?channel=${selectedChannel.value}`);
    chats.value = response.data.chats;
  } catch (error) {
    console.error('Failed to load chats:', error);
  }
}

// 防抖搜索
const debouncedSearch = debounce((query: string) => {
  // 搜索逻辑已通过 computed 实现
  console.log('Searching:', query);
}, 300);

watch(searchQuery, (newQuery) => {
  debouncedSearch(newQuery);
});

function selectChat(chat: Chat) {
  selectedChat.value = chat;
  emit('chat-selected', chat);
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

const emit = defineEmits<{
  (e: 'chat-selected', chat: Chat): void;
}>();

onMounted(() => {
  loadChannels();
});
</script>

<style scoped>
.chat-list {
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.search {
  margin-bottom: 20px;
}

.search input {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.chat-items {
  max-height: 600px;
  overflow-y: auto;
}

.chat-item {
  padding: 12px;
  border: 1px solid #eee;
  border-radius: 4px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.chat-item:hover {
  background-color: #f5f5f5;
}

.chat-title {
  font-weight: bold;
  margin-bottom: 4px;
}

.chat-meta {
  font-size: 12px;
  color: #666;
  display: flex;
  justify-content: space-between;
}
</style>