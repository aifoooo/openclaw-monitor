<template>
  <div class="message-detail">
    <div class="message-list">
      <div v-for="message in messages" :key="message.id" class="message">
        <div class="message-header">
          <span class="role" :class="message.role">
            {{ getRoleLabel(message.role) }}
          </span>
          <span class="time">{{ formatTime(message.timestamp) }}</span>
        </div>
        
        <div class="message-content">
          <div v-if="message.content" v-for="(item, idx) in message.content" :key="idx">
            <div v-if="item.type === 'text'" class="text-content">{{ item.text }}</div>
            <div v-else-if="item.type === 'thinking'" class="thinking-content">
              <details>
                <summary>思考过程</summary>
                <pre>{{ item.thinking }}</pre>
              </details>
            </div>
            <div v-else-if="item.type === 'toolCall'" class="tool-call">
              <strong>{{ item.toolCall.name }}</strong>
              <pre>{{ JSON.stringify(item.toolCall.arguments, null, 2) }}</pre>
            </div>
          </div>
        </div>
        
        <!-- 操作追踪 -->
        <div v-if="message.operations && message.operations.length > 0" class="operations">
          <h4>操作追踪</h4>
          <div v-for="op in message.operations" :key="op.id" class="operation">
            <div class="op-header">
              <span class="op-type" :class="op.type">{{ getOpTypeLabel(op.type) }}</span>
              <span class="op-name">{{ op.name }}</span>
              <span class="op-status" :class="op.status">{{ getStatusLabel(op.status) }}</span>
              <span class="op-duration">{{ op.durationMs }}ms</span>
            </div>
            <div class="op-content">
              <div v-if="op.input" class="op-input">
                <strong>输入:</strong>
                <pre>{{ formatInput(op.input) }}</pre>
              </div>
              <div v-if="op.output" class="op-output">
                <strong>输出:</strong>
                <pre>{{ formatOutput(op.output) }}</pre>
              </div>
            </div>
          </div>
        </div>
        
        <!-- LLM 详情 -->
        <div v-if="message.llmDetails" class="llm-details">
          <h4>LLM 调用详情</h4>
          <div class="llm-section">
            <strong>请求 Prompt:</strong>
            <pre>{{ JSON.stringify(message.llmDetails.requestPrompt, null, 2) }}</pre>
          </div>
          <div class="llm-section">
            <strong>响应内容:</strong>
            <pre>{{ JSON.stringify(message.llmDetails.responseContent, null, 2) }}</pre>
          </div>
          <div class="llm-meta">
            <span>耗时: {{ message.llmDetails.durationMs }}ms</span>
            <span>流式: {{ message.llmDetails.isStreaming ? '是' : '否' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import axios from 'axios';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'toolResult';
  content: any[];
  timestamp: number;
  operations?: any[];
  llmDetails?: any;
  usage?: any;
}

const props = defineProps<{
  chatId: string;
}>();

const messages = ref<Message[]>([]);

async function loadMessages() {
  try {
    const response = await axios.get(`/api/messages?chat=${props.chatId}`);
    messages.value = response.data.messages;
  } catch (error) {
    console.error('Failed to load messages:', error);
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

function getOpTypeLabel(type: string) {
  return type === 'tool' ? '🔧 工具' : '🤖 LLM';
}

function getStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: '⏳ 等待',
    running: '🔄 执行中',
    completed: '✅ 完成',
    failed: '❌ 失败'
  };
  return labels[status] || status;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function formatInput(input: any) {
  if (typeof input === 'string') return input;
  return JSON.stringify(input, null, 2);
}

function formatOutput(output: any) {
  if (typeof output === 'string') return output;
  return JSON.stringify(output, null, 2);
}

onMounted(() => {
  loadMessages();
});
</script>

<style scoped>
.message-detail {
  padding: 20px;
}

.message {
  margin-bottom: 24px;
  padding: 16px;
  border: 1px solid #eee;
  border-radius: 8px;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.role {
  padding: 4px 8px;
  border-radius: 4px;
  font-weight: bold;
}

.role.user {
  background: #e3f2fd;
  color: #1976d2;
}

.role.assistant {
  background: #f3e5f5;
  color: #7b1fa2;
}

.role.toolResult {
  background: #fff3e0;
  color: #f57c00;
}

.time {
  font-size: 12px;
  color: #666;
}

.text-content {
  white-space: pre-wrap;
}

.thinking-content details {
  margin-top: 8px;
}

.thinking-content summary {
  cursor: pointer;
  color: #666;
}

.thinking-content pre {
  margin-top: 8px;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 4px;
  font-size: 12px;
}

.tool-call {
  margin-top: 8px;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 4px;
}

.operations, .llm-details {
  margin-top: 16px;
  padding: 16px;
  background: #fafafa;
  border-radius: 8px;
}

.operation {
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid #eee;
  border-radius: 4px;
}

.op-header {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 8px;
}

.op-type {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 12px;
}

.op-type.tool {
  background: #e8f5e9;
  color: #388e3c;
}

.op-type.llm {
  background: #e3f2fd;
  color: #1976d2;
}

.op-status {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 12px;
}

.op-status.completed {
  background: #e8f5e9;
  color: #388e3c;
}

.op-status.running {
  background: #fff3e0;
  color: #f57c00;
}

.op-status.failed {
  background: #ffebee;
  color: #d32f2f;
}

.op-content pre {
  margin: 4px 0;
  padding: 4px;
  background: #f5f5f5;
  border-radius: 3px;
  font-size: 12px;
}

.llm-section {
  margin-bottom: 12px;
}

.llm-section pre {
  margin-top: 4px;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 4px;
  max-height: 200px;
  overflow: auto;
}

.llm-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #666;
}
</style>