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
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
});

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
    user: '用户',
    assistant: '助手',
    toolResult: '工具结果'
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
    // 先渲染 Markdown
    let html = md.render(content);
    
    // 渲染后处理被转义的特殊标签
    html = html
      .replace(/&lt;qqfile&gt;([^&]+)&lt;\/qqfile&gt;/g, '<span class="tag file">📎 文件: $1</span>')
      .replace(/&lt;qqimg&gt;([^&]+)&lt;\/qqimg&gt;/g, '<span class="tag image">🖼️ 图片: $1</span>')
      .replace(/&lt;qqvoice&gt;([^&]+)&lt;\/qqvoice&gt;/g, '<span class="tag voice">🔊 语音: $1</span>')
      .replace(/&lt;qqvideo&gt;([^&]+)&lt;\/qqvideo&gt;/g, '<span class="tag video">🎬 视频: $1</span>');
    
    return html;
  }
  
  if (Array.isArray(content)) {
    return content.map(item => {
      if (item.type === 'text') {
        return md.render(item.text || '');
      }
      return `<span class="tag unknown">[${item.type}]</span>`;
    }).join('');
  }
  
  return md.render(`\`\`\`json\n${JSON.stringify(content, null, 2)}\n\`\`\``);
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
  border-bottom: 1px solid #f0f0f0;
  background: #fff;
}

.message-header h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 4px 0;
  color: #333;
}

.session-info {
  font-size: 12px;
  color: #999;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: #f8f9fa;
}

.loading, .empty {
  text-align: center;
  padding: 24px;
  color: #999;
}

.message {
  margin-bottom: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}

.message.user {
  background: #e8f4fd;
  border-left: 3px solid #1976d2;
}

.message.assistant {
  background: #fff;
  border-left: 3px solid #9c27b0;
}

.message .message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  padding: 0;
  border: none;
  background: transparent;
}

.role {
  font-size: 12px;
  font-weight: 600;
  color: #666;
}

.role.user {
  color: #1976d2;
}

.role.assistant {
  color: #9c27b0;
}

.time {
  font-size: 11px;
  color: #999;
}

.text-content {
  font-size: 14px;
  line-height: 1.7;
  color: #333;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans SC', 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif;
}

/* Markdown 渲染样式 */
.text-content :deep(h1),
.text-content :deep(h2),
.text-content :deep(h3) {
  margin: 16px 0 8px 0;
  font-weight: 600;
  color: #333;
}

.text-content :deep(h2) {
  font-size: 16px;
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 8px;
}

.text-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
}

.text-content :deep(th),
.text-content :deep(td) {
  border: 1px solid #e0e0e0;
  padding: 8px 12px;
  text-align: left;
}

.text-content :deep(th) {
  background: #f5f5f5;
  font-weight: 600;
}

.text-content :deep(code) {
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 13px;
}

.text-content :deep(pre) {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 12px 0;
}

.text-content :deep(pre code) {
  background: transparent;
  padding: 0;
}

.text-content :deep(p) {
  margin: 8px 0;
}

.text-content :deep(ul),
.text-content :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.text-content :deep(li) {
  margin: 4px 0;
}

.text-content :deep(blockquote) {
  border-left: 3px solid #1976d2;
  padding-left: 12px;
  margin: 12px 0;
  color: #666;
}

.text-content :deep(hr) {
  border: none;
  border-top: 1px solid #e0e0e0;
  margin: 16px 0;
}

.text-content :deep(strong) {
  font-weight: 600;
}

.tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  margin: 2px 0;
}

.tag.file {
  background: #e3f2fd;
  color: #1565c0;
}

.tag.image {
  background: #f3e5f5;
  color: #7b1fa2;
}

.tag.voice {
  background: #e8f5e9;
  color: #2e7d32;
}

.tag.video {
  background: #fff3e0;
  color: #e65100;
}

.tag.unknown {
  background: #f5f5f5;
  color: #666;
}
</style>
