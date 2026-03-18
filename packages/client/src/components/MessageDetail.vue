<template>
  <div class="message-detail">
    <div class="message-header">
      <h3>{{ chatTitle }}</h3>
      <span class="session-info">{{ chatId }}</span>
    </div>
    
    <div class="message-list" ref="messageList">
      <div v-if="loading" class="loading">加载中...</div>
      <div v-else-if="messages.length === 0" class="empty">暂无消息</div>
      <div v-else>
        <div v-for="(message, index) in messages" :key="message.id || index" class="message" :class="message.role">
          <div class="message-header">
            <span class="role" :class="message.role">
              {{ getRoleLabel(message.role) }}
            </span>
            <span class="time">{{ formatTime(message.timestamp) }}</span>
          </div>
          
          <div class="message-content">
            <div v-if="message.content" class="text-content" v-html="formatContent(message.content)"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { fetchMessages } from '../services/api';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'toolResult';
  content: any;
  timestamp: number;
}

const props = defineProps<{
  chatId: string;
  sessionFile?: string;
}>();

const messages = ref<Message[]>([]);
const loading = ref(false);
const messageList = ref<HTMLElement | null>(null);

const chatTitle = computed(() => {
  if (!props.chatId) return '';
  const parts = props.chatId.split(':');
  if (parts.length >= 2) {
    return `${parts[0]} - ${parts[1].substring(0, 8)}...`;
  }
  return props.chatId;
});

async function loadMessages() {
  if (!props.chatId) return;
  
  loading.value = true;
  try {
    const data = await fetchMessages(props.chatId);
    messages.value = data.messages || [];
    
    // 滚动到底部
    setTimeout(() => {
      if (messageList.value) {
        messageList.value.scrollTop = messageList.value.scrollHeight;
      }
    }, 100);
  } catch (error) {
    console.error('Failed to load messages:', error);
  } finally {
    loading.value = false;
  }
}

function getRoleLabel(role: string) {
  const labels: Record<string, string> = {
    user: '👤 用户',
    assistant: '🤖 助手',
    toolResult: '🔧 工具结果'
  };
  return labels[role] || role;
}

function formatTime(timestamp: number) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatContent(content: any): string {
  if (typeof content === 'string') {
    return escapeHtml(content).replace(/\n/g, '<br>');
  }
  
  if (Array.isArray(content)) {
    return content.map(item => {
      if (item.type === 'text') {
        return escapeHtml(item.text || '').replace(/\n/g, '<br>');
      }
      return `[${item.type}]`;
    }).join('');
  }
  
  return escapeHtml(JSON.stringify(content, null, 2));
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

watch(() => props.chatId, () => {
  loadMessages();
});

onMounted(() => {
  loadMessages();
});
</script>

<style scoped>
.message-detail {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.message-header {
  padding: 16px 20px;
  border-bottom: 1px solid #e0e0e0;
  background: #fff;
}

.message-header h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 4px 0;
}

.session-info {
  font-size: 12px;
  color: #999;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: #fafafa;
}

.loading, .empty {
  text-align: center;
  padding: 24px;
  color: #999;
}

.message {
  margin-bottom: 16px;
  padding: 12px 16px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

.message.user {
  background: #e3f2fd;
}

.message.assistant {
  background: #f3e5f5;
}

.message .message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding: 0;
  border: none;
  background: transparent;
}

.role {
  font-size: 12px;
  font-weight: 500;
}

.time {
  font-size: 11px;
  color: #999;
}

.text-content {
  font-size: 14px;
  line-height: 1.6;
  color: #333;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
