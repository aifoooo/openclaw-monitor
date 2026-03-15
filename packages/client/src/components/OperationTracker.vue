<template>
  <div class="operation-tracker">
    <div class="stats">
      <div class="stat-item">
        <span class="label">总操作数:</span>
        <span class="value">{{ totalOperations }}</span>
      </div>
      <div class="stat-item">
        <span class="label">总耗时:</span>
        <span class="value">{{ totalDuration }}ms</span>
      </div>
      <div class="stat-item">
        <span class="label">平均耗时:</span>
        <span class="value">{{ avgDuration }}ms</span>
      </div>
    </div>
    
    <div class="timeline">
      <div v-for="op in operations" :key="op.id" class="timeline-item">
        <div class="timeline-line"></div>
        <div class="timeline-dot" :class="op.type"></div>
        <div class="timeline-content">
          <div class="op-header">
            <span class="op-icon">{{ getOpIcon(op.type) }}</span>
            <span class="op-name">{{ op.name }}</span>
            <span class="op-duration">{{ op.durationMs }}ms</span>
          </div>
          <div class="op-meta">
            <span class="op-status" :class="op.status">{{ getStatusText(op.status) }}</span>
            <span class="op-time">{{ formatTime(op.startedAt) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Operation {
  id: string;
  type: 'tool' | 'llm';
  name: string;
  durationMs: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: number;
}

const props = defineProps<{
  operations: Operation[];
}>();

const totalOperations = computed(() => props.operations.length);
const totalDuration = computed(() => 
  props.operations.reduce((sum, op) => sum + op.durationMs, 0)
);
const avgDuration = computed(() => 
  totalOperations.value > 0 ? Math.round(totalDuration.value / totalOperations.value) : 0
);

function getOpIcon(type: string) {
  return type === 'tool' ? '🔧' : '🤖';
}

function getStatusText(status: string) {
  const map: Record<string, string> = {
    pending: '等待',
    running: '执行中',
    completed: '完成',
    failed: '失败'
  };
  return map[status] || status;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString();
}
</script>

<style scoped>
.operation-tracker {
  padding: 20px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 8px;
}

.stat-item .label {
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
}

.stat-item .value {
  font-size: 20px;
  font-weight: bold;
  color: #333;
}

.timeline {
  position: relative;
  padding-left: 20px;
}

.timeline-line {
  position: absolute;
  left: 6px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #e0e0e0;
}

.timeline-item {
  position: relative;
  margin-bottom: 16px;
  padding-left: 20px;
}

.timeline-dot {
  position: absolute;
  left: -4px;
  top: 8px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #2196f3;
}

.timeline-dot.tool {
  background: #4caf50;
}

.timeline-dot.llm {
  background: #ff9800;
}

.timeline-content {
  padding: 12px;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}

.op-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.op-icon {
  font-size: 16px;
}

.op-name {
  font-weight: bold;
}

.op-duration {
  margin-left: auto;
  font-size: 12px;
  color: #666;
}

.op-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #666;
}

.op-status {
  padding: 2px 6px;
  border-radius: 3px;
}

.op-status.completed {
  background: #e8f5e9;
  color: #2e7d32;
}

.op-status.running {
  background: #fff3e0;
  color: #ef6c00;
}

.op-status.failed {
  background: #ffebee;
  color: #c62828;
}
</style>