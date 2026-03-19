<template>
  <div class="chat-list">
    <div class="header">
      <h2>聊天列表</h2>
      <span class="count">{{ filteredChats.length }} 个会话</span>
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
           @click="selectChat(chat)"
           @contextmenu.prevent="showContextMenu($event, chat)">
        <div class="chat-title">{{ chat.title || chat.sessionKey }}</div>
        <div class="chat-meta">
          <span class="channel">{{ chat.channelId }}</span>
          <span class="time">{{ formatTime(chat.lastMessageAt) }}</span>
        </div>
      </div>
    </div>
    
    <!-- 右键菜单 -->
    <div v-if="contextMenu.visible" 
         class="context-menu" 
         :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }">
      <div class="context-menu-item" @click="hideChat(contextMenu.chat)">
        🙈 隐藏此聊天
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, onUnmounted } from 'vue';
import { fetchChats, hideChat as hideChatApi } from '../services/api';
import { debounce } from '../utils/performance';

interface Chat {
  id: string;
  channelId: string;
  accountId: string;
  title: string;
  sessionKey: string;
  sessionFile?: string;
  lastMessageAt: number;
  messageCount: number;
  isHidden?: boolean;
}

const props = defineProps<{
  channelId?: string;
}>();

const chats = ref<Chat[]>([]);
const searchQuery = ref('');
const selectedChatId = ref<string>('');
const loading = ref(false);

// 右键菜单状态
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  chat: null as Chat | null,
});

const filteredChats = computed(() => {
  let result = chats.value;
  
  // 按渠道筛选
  if (props.channelId) {
    result = result.filter(chat => chat.channelId === props.channelId);
  }
  
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
    // 加载所有聊天
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

// 右键菜单
function showContextMenu(event: MouseEvent, chat: Chat) {
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    chat,
  };
}

function hideContextMenu() {
  contextMenu.value.visible = false;
  contextMenu.value.chat = null;
}

async function hideChat(chat: Chat | null) {
  if (!chat) return;
  
  try {
    await hideChatApi(chat.id);
    
    // 从列表中移除
    chats.value = chats.value.filter(c => c.id !== chat.id);
    
    // 如果当前选中的是被隐藏的聊天，清空选中
    if (selectedChatId.value === chat.id) {
      selectedChatId.value = '';
      emit('chat-selected', null);
    }
    
    // 通知父组件更新隐藏数量
    emit('chat-hidden');
    
    hideContextMenu();
  } catch (error) {
    console.error('Failed to hide chat:', error);
  }
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
  (e: 'chat-selected', chat: Chat | null): void;
  (e: 'chat-hidden'): void;
}>();

// 暴露刷新方法给父组件
defineExpose({
  refresh: loadChats,
});

// 点击其他地方关闭菜单
function handleClickOutside() {
  hideContextMenu();
}

onMounted(() => {
  loadChats();
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
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
  background: #f0f0f0;
  padding: 2px 8px;
  border-radius: 10px;
}

.search {
  margin-bottom: 12px;
}

.search input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid #e0e0e0;
  border-radius: 10px;
  font-size: 14px;
  transition: all 0.2s;
  background: #fafafa;
}

.search input:focus {
  outline: none;
  border-color: #1976d2;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(25, 118, 210, 0.1);
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
  padding: 14px 16px;
  border-radius: 10px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.chat-item:hover {
  background-color: #f5f7fa;
  border-color: #e8e8e8;
}

.chat-item.active {
  background-color: #e8f4fd;
  border-color: #1976d2;
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
  background: #f0f2f5;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
}

/* 右键菜单 */
.context-menu {
  position: fixed;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  min-width: 150px;
  overflow: hidden;
}

.context-menu-item {
  padding: 12px 16px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s;
}

.context-menu-item:hover {
  background-color: #f5f7fa;
}
</style>
