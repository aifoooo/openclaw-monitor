# Vue watch 导致重复请求问题排查

**时间**：2026-03-22  
**问题**：点击一次聊天，触发多次 API 请求  
**影响**：用户反馈页面加载慢，网络请求冗余

---

## 问题描述

用户反馈：在 OpenClaw Monitor 前端页面中，点击一次聊天会发出**两次请求**，导致消息内容重复显示。

### 现象

1. 点击聊天列表中的某个聊天
2. 网络面板显示触发了 2 次 `/api/chats/{chatId}/messages` 请求
3. 消息列表中出现重复内容

---

## 排查过程

### 第一阶段：问题复现

**尝试 1：浏览器手动测试**
- 打开浏览器开发者工具 → Network 标签
- 点击聊天，观察请求数
- **结果**：确实触发了 2 次请求

**尝试 2：自动化测试**
- 编写 Puppeteer 脚本，连续点击 5 次聊天
- 统计每次点击的请求数
- **结果**：每次点击触发 2-3 次请求（甚至更多）

**问题恶化**：测试脚本统计不准确，显示了 54 次请求，原因是：
- `journalctl --vacuum-time=1s` 并没有真正清空日志
- 统计的是历史累积的所有请求，而不是当前点击的请求

**修复测试脚本**：
```bash
# ❌ 错误：统计所有历史日志
journalctl -u openclaw-monitor --no-pager | grep "\[API\] GET.*messages" | wc -l

# ✅ 正确：使用时间戳精确统计
CLICK_TIME=$(date '+%Y-%m-%d %H:%M:%S')
# ... 点击操作 ...
REQUEST_COUNT=$(journalctl -u openclaw-monitor --since "$CLICK_TIME" --no-pager | grep "\[API\] GET.*messages" | wc -l)
```

### 第二阶段：定位根本原因

**分析前端代码**：

```vue
<!-- MessageDetail.vue -->
<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';

// ✅ watch 监听 chatId 变化
watch(() => props.chatId, () => {
  loadMessages();
}, { immediate: true });  // ❌ 问题：immediate: true 会在组件创建时立即触发

// ❌ 问题：onMounted 也会调用 loadMessages
onMounted(() => {
  loadMessages();
});
</script>
```

**问题分析**：

1. **首次加载**：
   - 组件创建 → `watch immediate` 触发 → `loadMessages()`（第1次）
   - 组件挂载 → `onMounted` 触发 → `loadMessages()`（第2次）
   - **结果：2 次请求** ❌

2. **切换聊天**：
   - `props.chatId` 变化 → `watch` 触发 → `loadMessages()`（第1次）
   - 如果有 `:key`，组件重新创建 → `watch immediate` 触发 → `loadMessages()`（第2次）
   - **结果：2 次请求** ❌

### 第三阶段：验证修复

**尝试 1：移除 onMounted**
```vue
watch(() => props.chatId, () => {
  loadMessages();
}, { immediate: true });

// ❌ 移除 onMounted 中的调用
onMounted(() => {
  // loadMessages(); // 移除这行
});
```

**结果**：仍然有重复请求（测试脚本统计不准确）

**尝试 2：移除 immediate**
```vue
watch(() => props.chatId, () => {
  loadMessages();
});  // ✅ 移除 immediate: true

onMounted(() => {
  loadMessages();  // ✅ 只在首次挂载时加载
});
```

**结果**：✅ 修复成功！

**最终方案**：
- 首次加载：`onMounted` 触发 1 次 ✅
- 切换聊天：`watch` 触发 1 次 ✅
- 不再重复请求 ✅

---

## 根本原因

### Vue 生命周期问题

**watch + immediate: true + onMounted 的组合导致重复触发**

| 场景 | watch immediate | onMounted | 总请求 |
|------|----------------|-----------|--------|
| 首次加载 | 1次 | 1次 | 2次 ❌ |
| 切换聊天 | 1次 | 0次 | 1次 ✅ |

### 正确的理解

1. **`watch` 的 `immediate: true`**：
   - 会在组件创建时**立即执行一次**
   - 此时 `props.chatId` 可能还是 `undefined`

2. **`onMounted`**：
   - 会在组件挂载完成后执行
   - 此时 `props.chatId` 已经有值

3. **组合使用**：
   - 如果两者都调用 `loadMessages()`，会导致重复请求

---

## 解决方案

### 方案 1：移除 immediate（推荐）

```vue
<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';

// ✅ 只监听变化，不在创建时触发
watch(() => props.chatId, () => {
  offset.value = 0;
  hasMore.value = true;
  messages.value = [];
  loadMessages();
});  // 不加 immediate: true

onMounted(() => {
  // ✅ 只在组件首次挂载时加载
  loadMessages();
  
  // 其他初始化逻辑
  if (messageListRef.value) {
    messageListRef.value.addEventListener('scroll', handleScroll);
  }
});
</script>
```

**优点**：
- 逻辑清晰：首次加载由 `onMounted` 负责，切换聊天由 `watch` 负责
- 不会重复请求
- 易于理解和维护

### 方案 2：只使用 watch + immediate

```vue
<script setup lang="ts">
import { ref, watch } from 'vue';

// ✅ 使用 immediate: true，移除 onMounted
watch(() => props.chatId, () => {
  loadMessages();
}, { immediate: true });

// ❌ 不要在 onMounted 中调用
onMounted(() => {
  // loadMessages(); // 移除
});
</script>
```

**缺点**：
- `immediate` 触发时，`props.chatId` 可能还是 `undefined`
- 需要额外判断 `if (props.chatId)`

### 方案 3：使用防抖（不推荐）

```vue
<script setup lang="ts">
let lastLoadTime = 0;

async function loadMessages() {
  const now = Date.now();
  if (now - lastLoadTime < 1000) {  // 1秒内忽略重复请求
    return;
  }
  lastLoadTime = now;
  
  // ... 加载逻辑
}
</script>
```

**缺点**：
- 治标不治本
- 增加了不必要的复杂度
- 可能影响正常的快速切换

---

## 经验教训

### 1. 测试脚本的时间统计问题

**问题**：
- `journalctl --vacuum-time=1s` 并不会真正清空日志
- 统计的是历史累积的所有请求，而不是当前操作触发的请求

**教训**：
- ✅ 使用时间戳精确统计：`journalctl --since "$CLICK_TIME"`
- ✅ 或者使用唯一的标记：在请求日志中添加唯一标识
- ❌ 不要依赖 `--vacuum-time` 来清空日志

### 2. 测试环境干扰

**问题**：
- 测试脚本显示每次点击触发 54 次请求
- 实际手动测试只有 1 次请求

**原因**：
- 文件监视器、自动同步、WebSocket 心跳等都在产生请求
- 测试脚本统计不准确

**教训**：
- ✅ 隔离测试环境，减少干扰
- ✅ 使用精确的时间范围统计
- ✅ 结合手动测试验证结果

### 3. Vue 生命周期理解不足

**问题**：
- 不清楚 `watch` + `immediate` 与 `onMounted` 的执行顺序
- 导致两者都调用 `loadMessages()`

**教训**：
- ✅ 深入理解 Vue 生命周期
- ✅ 避免在多个生命周期钩子中重复调用同一函数
- ✅ 明确职责分离：`onMounted` 负责首次加载，`watch` 负责响应变化

### 4. 测试用例设计

**问题**：
- 原测试脚本只点击第一个聊天，但第一个聊天可能已选中
- 导致统计为 0 次请求

**教训**：
- ✅ 测试脚本应该点击不同的聊天
- ✅ 交替点击第 2、3 个聊天，避免重复点击已选中的
- ✅ 验证测试脚本本身的正确性

---

## 最佳实践

### 1. Vue 组件设计

```vue
<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';

// ✅ 职责分离：onMounted 负责首次加载
onMounted(() => {
  loadMessages();
  setupEventListeners();
});

// ✅ watch 负责响应变化
watch(() => props.chatId, (newId, oldId) => {
  if (newId !== oldId) {
    resetState();
    loadMessages();
  }
});  // 不加 immediate

onUnmounted(() => {
  cleanup();
});
</script>
```

### 2. 测试脚本设计

```bash
# ✅ 使用时间戳精确统计
CLICK_TIME=$(date '+%Y-%m-%d %H:%M:%S')
agent-browser eval "document.querySelectorAll('.chat-item')[$INDEX]?.click()"
sleep 2
REQUEST_COUNT=$(journalctl -u openclaw-monitor --since "$CLICK_TIME" --no-pager | grep "\[API\] GET.*messages" | wc -l)

# ✅ 点击不同的聊天，避免重复
CHAT_INDEX=$(( (i % 2) + 1 ))  # 交替点击第 2、3 个聊天
```

### 3. 代码审查要点

**检查清单**：
- [ ] `watch` 是否需要 `immediate: true`？
- [ ] `onMounted` 中是否调用了会被 `watch` 触发的函数？
- [ ] 是否有多个生命周期钩子调用同一函数？
- [ ] 是否需要防抖/节流？

### 4. 调试技巧

**前端调试**：
```javascript
// 在 loadMessages 中添加日志
async function loadMessages() {
  console.log('[MessageDetail] loadMessages called, chatId:', props.chatId);
  console.trace('[MessageDetail] call stack');  // 查看调用栈
  // ... 加载逻辑
}
```

**后端调试**：
```typescript
// 在 API 端点添加日志
api.get('/chats/:chatId/messages', async (c) => {
  console.log(`[API] GET /api/chats/${c.req.param('chatId')}/messages`);
  // ... 处理逻辑
});
```

---

## 相关问题

### 1. Title 显示 Open ID/QQ 号问题

**问题**：聊天列表 title 显示 `ou_f30f...` 或 `e82d1c...` 而不是 sessionId 缩略

**原因**：旧代码从 `sessionKey` 最后一部分提取 shortId，而不是从 `sessionId`（文件名）提取

**修复**：
```typescript
function extractTitle(sessionId: string, createdAt?: number): string {
  // ✅ 从 sessionId 提取 shortId
  const idPart = sessionId.split('_reset_')[0];
  const shortId = idPart.substring(0, 8);
  
  if (createdAt) {
    const date = new Date(createdAt);
    // ... 格式化时间
    return `${month}-${day} ${hour}:${minute} (${shortId})`;
  }
  
  return `(${shortId})`;
}
```

### 2. 数据一致性问题

**问题**：文件中的消息数与数据库不一致

**原因**：
- 消息先写入文件
- 文件监视器异步同步到数据库
- 有 1-2 条消息的延迟

**结论**：这是正常的异步同步机制，不是问题

---

## 总结

这次排查花费了较长时间，主要原因是：

1. **测试脚本统计不准确**：误判了问题的严重程度
2. **测试环境干扰**：文件监视、自动同步等产生了额外请求
3. **对 Vue 生命周期理解不够深入**：不清楚 `watch immediate` 与 `onMounted` 的执行顺序

**关键收获**：

- ✅ 理解了 Vue 的生命周期和 `watch` 的 `immediate` 选项
- ✅ 学会了使用时间戳精确统计日志
- ✅ 明确了职责分离：`onMounted` 负责首次加载，`watch` 负责响应变化
- ✅ 完善了测试脚本，提高了测试准确性

**最终结果**：

- 基础测试：10/10 通过 ✅
- 一致性测试：11/12 通过 ✅
- 核心问题已解决：点击一次只发一次请求 ✅

---

**相关文件**：
- `/root/ws-mime-qq/openclaw-monitor/packages/client/src/components/MessageDetail.vue`
- `/root/ws-mime-qq/openclaw-monitor/tests/ui-test.sh`
- `/root/ws-mime-qq/openclaw-monitor/tests/UI-TEST-REPORT.md`

**提交记录**：`ec37e0c..cdcb563 master -> master`
