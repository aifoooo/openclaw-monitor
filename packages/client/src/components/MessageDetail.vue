<template>
  <div class="message-detail">
    <!-- Header -->
    <div class="detail-header">
      <div class="header-info">
        <h3 class="header-title">{{ chat?.title || '聊天详情' }}</h3>
        <div class="header-session">{{ chat?.sessionKey }}</div>
      </div>
      <span class="message-count">{{ total }} 条消息</span>
    </div>

    <!-- Messages -->
    <div class="message-list" ref="messageListRef">
      <!-- Initial Loading -->
      <div v-if="loading && messages.length === 0" class="loading-state">
        <div class="skeleton-message"></div>
        <div class="skeleton-message"></div>
      </div>

      <!-- Empty -->
      <div v-else-if="messages.length === 0" class="empty-state">
        暂无消息
      </div>

      <!-- Messages -->
      <div v-else class="messages">
        <!-- Load More (at top) -->
        <div v-if="hasMore" class="load-more" :class="{ 'loading': isLoadingMore }" @click="loadMore">
          <span v-if="isLoadingMore" class="loading-spinner">⟳</span>
          <span>{{ isLoadingMore ? '加载中...' : '↑ 加载更早的消息' }}</span>
        </div>
        
        <div 
          v-for="msg in messages" 
          :key="msg.id"
          class="message"
          :class="msg.role"
        >
          <div class="message-header">
            <span class="message-role" :class="msg.role">
              {{ msg.role === 'user' ? '用户' : '助手' }}
            </span>
            <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
          </div>
          
          <!-- 渲染消息内容 -->
          <div class="message-content">
            <template v-if="typeof msg.content === 'string'">
              <div v-html="renderMarkdown(msg.content)"></div>
            </template>
            <template v-else-if="Array.isArray(msg.content)">
              <div v-for="(block, idx) in msg.content" :key="idx" class="content-block" :class="block.type">
                <div v-if="block.type === 'text'" v-html="renderMarkdown(block.text)"></div>
                <div v-else-if="block.type === 'thinking'" class="thinking-block">
                  <div class="thinking-header" @click="toggleThinking(msg.id + '-' + idx)">
                    <span class="thinking-icon">💭</span>
                    <span class="thinking-label">思考过程</span>
                    <span class="thinking-toggle">{{ expandedThinkings.has(msg.id + '-' + idx) ? '▼' : '▶' }}</span>
                  </div>
                  <div v-if="expandedThinkings.has(msg.id + '-' + idx)" class="thinking-content" v-html="renderMarkdown(block.thinking || block.text)"></div>
                </div>
                <div v-else-if="block.type === 'toolCall'" class="tool-call-block">
                  <div class="tool-header">
                    <span class="tool-icon">🔧</span>
                    <span class="tool-name">{{ block.name }}</span>
                  </div>
                  <pre class="tool-arguments">{{ JSON.stringify(block.arguments, null, 2) }}</pre>
                </div>
                <div v-else-if="block.type === 'toolResult'" class="tool-result-block">
                  <div class="result-header">
                    <span class="result-icon">📋</span>
                    <span class="result-label">工具结果</span>
                  </div>
                  <pre class="result-content">{{ typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2) }}</pre>
                </div>
              </div>
            </template>
          </div>
          
          <div v-if="msg.attachments?.length" class="attachments">
            <span v-for="att in msg.attachments" :key="att.url" class="attachment-tag" :class="att.type">
              {{ att.type }}: {{ att.name }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { fetchMessages } from '../services/api';
import MarkdownIt from 'markdown-it';

// 支持字符串或数组格式的 content
interface ContentBlock {
  type: 'text' | 'thinking' | 'toolCall' | 'toolResult';
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: any;
  content?: any;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
  timestamp: number;
  attachments?: { type: string; name: string; url: string }[];
}

const props = defineProps<{
  chatId: string;
  sessionFile: string;
}>();

const chat = ref<any>(null);
const messages = ref<Message[]>([]);
const loading = ref(false);
const isLoadingMore = ref(false);  // 区分初始加载和加载更多
const total = ref(0);
const offset = ref(0);
const hasMore = ref(true);
const messageListRef = ref<HTMLElement | null>(null);
const expandedThinkings = ref<Set<string>>(new Set());

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

function renderMarkdown(content: string): string {
  return md.render(content || '');
}

function toggleThinking(key: string) {
  if (expandedThinkings.value.has(key)) {
    expandedThinkings.value.delete(key);
  } else {
    expandedThinkings.value.add(key);
  }
}

async function loadMessages() {
  if (!props.chatId) return;
  
  loading.value = true;
  try {
    // 后端返回降序（最新的在前），需要反转为升序显示
    const limit = 20;
    const data = await fetchMessages(props.chatId, limit, 0);
    // 反转消息顺序，让最新的显示在底部
    messages.value = (data.messages || []).reverse();
    total.value = data.total || 0;
    offset.value = limit;
    hasMore.value = messages.value.length < total.value;
    
    // ✅ 只在初始加载时滚动到底部
    if (messages.value.length > 0 && offset.value === limit) {
      scrollToBottom();
    }
  } catch (error) {
    console.error('Failed to load messages:', error);
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  if (!hasMore.value || isLoadingMore.value) return;
  
  // 记住当前滚动位置
  const oldScrollHeight = messageListRef.value?.scrollHeight || 0;
  
  isLoadingMore.value = true;
  try {
    // 加载更早的消息（后端返回降序）
    const limit = 20;
    const data = await fetchMessages(props.chatId, limit, offset.value);
    const olderMessages = data.messages || [];
    
    if (olderMessages.length > 0) {
      // 反转后添加到开头（保持升序显示）
      messages.value = [...olderMessages.reverse(), ...messages.value];
      offset.value += limit;
      hasMore.value = olderMessages.length === limit;
      
      // 保持滚动位置（防止跳动）
      nextTick(() => {
        if (messageListRef.value) {
          const newScrollHeight = messageListRef.value.scrollHeight;
          messageListRef.value.scrollTop = newScrollHeight - oldScrollHeight;
        }
      });
    } else {
      hasMore.value = false;
    }
  } catch (error) {
    console.error('Failed to load more messages:', error);
  } finally {
    isLoadingMore.value = false;
  }
}

function appendMessage(msg: Message) {
  // ✅ 保存当前滚动位置信息（在添加消息前）
  const list = messageListRef.value;
  const scrollHeightBefore = list ? list.scrollHeight : 0;
  const scrollTopBefore = list ? list.scrollTop : 0;
  const clientHeightBefore = list ? list.clientHeight : 0;
  
  // 判断添加消息前是否在底部（距离底部 < 10px）
  const wasAtBottom = list ? (scrollHeightBefore - scrollTopBefore - clientHeightBefore) < 10 : false;
  
  // ✅ 添加消息
  messages.value.push(msg);
  total.value++;
  
  // ✅ 只有在添加消息前就在底部，才自动滚动
  if (wasAtBottom) {
    console.log('[MessageDetail] Was at bottom, scrolling to bottom');
    scrollToBottom();
  } else {
    console.log('[MessageDetail] Was not at bottom, keeping position');
  }
}

function refresh() {
  offset.value = 0;
  hasMore.value = true;
  messages.value = [];
  total.value = 0;
  loadMessages();
}

/**
 * ✅ 检测滚动条是否在底部（严格模式）
 * 
 * 判断逻辑：距离底部小于 10px 才认为是在底部
 * 之前是 100px，太宽松了
 */
function isScrolledToBottom(): boolean {
  if (!messageListRef.value) return false; // 改为 false，更安全
  
  const { scrollTop, scrollHeight, clientHeight } = messageListRef.value;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  
  // 只有距离底部小于 10px 才算在底部
  return distanceFromBottom < 10;
}

function scrollToBottom() {
  nextTick(() => {
    setTimeout(() => {
      if (messageListRef.value) {
        messageListRef.value.scrollTop = messageListRef.value.scrollHeight;
        console.log('[MessageDetail] Auto-scrolled to bottom');
      }
    }, 100);
  });
}

// 滚动监听：滚动到顶部时自动加载更多
function handleScroll() {
  if (!messageListRef.value || isLoadingMore.value || !hasMore.value) return;
  
  const { scrollTop } = messageListRef.value;
  
  // 滚动到顶部附近（小于 100px）时自动加载
  if (scrollTop < 100) {
    loadMore();
  }
}

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

defineExpose({
  refresh,
  appendMessage,
});

watch(() => props.chatId, () => {
  offset.value = 0;
  hasMore.value = true;
  messages.value = [];
  loadMessages();
});  // ✅ 移除 immediate: true，避免首次加载时重复触发

onMounted(() => {
  // ✅ 只在组件首次挂载时加载一次
  loadMessages();
  
  // 添加滚动监听
  if (messageListRef.value) {
    messageListRef.value.addEventListener('scroll', handleScroll);
  }
});

onUnmounted(() => {
  // 移除滚动监听
  if (messageListRef.value) {
    messageListRef.value.removeEventListener('scroll', handleScroll);
  }
});
</script>

<style scoped>
/* ==================== QQ 风格消息详情 ==================== */
/* 无圆角，紧凑布局 */

.message-detail {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: oklch(97% 0.005 250);
}

/* Header */
.detail-header {
  height: 56px;
  padding: 0 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: oklch(99% 0.002 250);
  border-bottom: 1px solid oklch(92% 0.005 250);
  
  /* 无圆角 */
  border-radius: 0;
}

.header-info {
  display: flex;
  flex-direction: column;
}

.header-title {
  font-size: 14px;
  font-weight: 600;
  color: oklch(25% 0.02 250);
  margin: 0;
}

.header-session {
  font-size: 11px;
  color: oklch(50% 0.01 250);
  margin-top: 2px;
}

.message-count {
  font-size: 11px;
  font-weight: 600;
  color: oklch(50% 0.01 250);
  background: oklch(94% 0.005 250);
  padding: 2px 8px;
  border-radius: 10px;
}

/* Message List */
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.load-more {
  text-align: center;
  padding: 12px;
  margin-bottom: 12px;
  cursor: pointer;
  color: oklch(55% 0.18 250);
  font-size: 12px;
  background: oklch(98% 0.005 250);
  border-radius: 8px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.load-more:hover {
  background: oklch(96% 0.01 250);
}

.load-more.loading {
  cursor: wait;
  opacity: 0.7;
}

.loading-spinner {
  display: inline-block;
  animation: spin 1s linear infinite;
  font-size: 14px;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.loading-state {
  padding: 12px;
}

.skeleton-message {
  height: 80px;
  background: oklch(96% 0.005 250);
  margin-bottom: 8px;
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

/* Message */
.message {
  margin-bottom: 8px;
  padding: 10px 12px;
  background: oklch(99% 0.002 250);
  border-left: 3px solid oklch(75% 0.01 250);
}

.message.user {
  background: oklch(96% 0.03 250);
  border-left-color: oklch(55% 0.18 250);
}

.message.assistant {
  border-left-color: oklch(60% 0.2 300);
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.message-role {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: oklch(50% 0.01 250);
}

.message-role.user {
  color: oklch(55% 0.18 250);
}

.message-role.assistant {
  color: oklch(60% 0.2 300);
}

.message-time {
  font-size: 11px;
  color: oklch(50% 0.01 250);
  font-variant-numeric: tabular-nums;
}

.message-content {
  font-size: 13px;
  line-height: 1.6;
  color: oklch(25% 0.02 250);
}

.message-content :deep(p) {
  margin: 4px 0;
}

.message-content :deep(code) {
  background: oklch(94% 0.005 250);
  padding: 1px 4px;
  border-radius: 2px;
  font-family: monospace;
  font-size: 12px;
}

.message-content :deep(pre) {
  background: oklch(94% 0.005 250);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 8px 0;
}

.message-content :deep(pre code) {
  background: transparent;
  padding: 0;
}

.message-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 12px;
}

.message-content :deep(th),
.message-content :deep(td) {
  border: 1px solid oklch(88% 0.005 250);
  padding: 6px 8px;
  text-align: left;
}

/* 列表样式 */
.message-content :deep(ol),
.message-content :deep(ul) {
  margin: 8px 0;
  padding-left: 24px;
}

.message-content :deep(ol) {
  list-style-type: decimal;
}

.message-content :deep(ul) {
  list-style-type: disc;
}

.message-content :deep(li) {
  margin: 4px 0;
  line-height: 1.6;
}

.message-content :deep(li > ol),
.message-content :deep(li > ul) {
  margin: 4px 0;
  padding-left: 20px;
}

.message-content :deep(th) {
  background: oklch(96% 0.005 250);
  font-weight: 600;
}

/* Content Blocks */
.content-block {
  margin-bottom: 8px;
}

.content-block:last-child {
  margin-bottom: 0;
}

/* Thinking Block */
.thinking-block {
  background: oklch(96% 0.01 280);
  border: 1px solid oklch(90% 0.01 280);
  border-radius: 4px;
  margin: 8px 0;
}

.thinking-header {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
}

.thinking-header:hover {
  background: oklch(94% 0.01 280);
}

.thinking-icon {
  margin-right: 6px;
}

.thinking-label {
  font-size: 12px;
  font-weight: 500;
  color: oklch(45% 0.02 280);
}

.thinking-toggle {
  margin-left: auto;
  font-size: 10px;
  color: oklch(50% 0.01 280);
}

.thinking-content {
  padding: 8px 10px;
  border-top: 1px solid oklch(90% 0.01 280);
  font-size: 12px;
  color: oklch(40% 0.01 280);
  background: oklch(98% 0.005 280);
}

/* Tool Call Block */
.tool-call-block {
  background: oklch(96% 0.01 180);
  border: 1px solid oklch(90% 0.01 180);
  border-radius: 4px;
  margin: 8px 0;
}

.tool-header {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  background: oklch(94% 0.01 180);
}

.tool-icon {
  margin-right: 6px;
}

.tool-name {
  font-size: 12px;
  font-weight: 600;
  color: oklch(35% 0.02 180);
  font-family: monospace;
}

.tool-arguments {
  padding: 8px 10px;
  margin: 0;
  font-size: 11px;
  color: oklch(40% 0.01 180);
  background: oklch(98% 0.005 180);
  overflow-x: auto;
}

/* Tool Result Block */
.tool-result-block {
  background: oklch(96% 0.01 60);
  border: 1px solid oklch(90% 0.01 60);
  border-radius: 4px;
  margin: 8px 0;
}

.result-header {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  background: oklch(94% 0.01 60);
}

.result-icon {
  margin-right: 6px;
}

.result-label {
  font-size: 12px;
  font-weight: 600;
  color: oklch(35% 0.02 60);
}

.result-content {
  padding: 8px 10px;
  margin: 0;
  font-size: 11px;
  color: oklch(40% 0.01 60);
  background: oklch(98% 0.005 60);
  overflow-x: auto;
  max-height: 200px;
}

.attachments {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.attachment-tag {
  font-size: 11px;
  padding: 2px 6px;
  background: oklch(94% 0.005 250);
  border-radius: 2px;
  color: oklch(50% 0.01 250);
}

.attachment-tag.image {
  background: oklch(92% 0.05 300);
  color: oklch(45% 0.15 300);
}

.attachment-tag.file {
  background: oklch(92% 0.05 250);
  color: oklch(45% 0.15 250);
}

.load-more.loading {
  pointer-events: none;
  opacity: 0.7;
}

.loading-spinner {
  display: inline-block;
  animation: spin 1s linear infinite;
  margin-right: 8px;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>