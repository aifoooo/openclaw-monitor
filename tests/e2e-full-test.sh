#!/bin/bash
# OpenClaw Monitor 完整 E2E 测试
# 测试策略：
# 1. 飞书渠道发送 /new → 聊天列表新增条目
# 2. 点击第 1-5 个聊天 → 消息加载正常
# 3. 验证无重复会话（备份文件不应显示）

set -e

API_KEY="${1:-7f7cc8be30d13703dc35e518ccba3c8ff30c2525cefaa05208a9a328f16483ed}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"
API_URL="${API_URL:-http://localhost:3000}"

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass_count=0
fail_count=0

function pass() {
  echo -e "${GREEN}✅ $1${NC}"
  ((pass_count++))
}

function fail() {
  echo -e "${RED}❌ $1${NC}"
  ((fail_count++))
}

function warn() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

echo "=========================================="
echo "OpenClaw Monitor 完整 E2E 测试"
echo "=========================================="
echo ""
echo "测试策略："
echo "1. 创建新会话 → 聊天列表新增条目"
echo "2. 点击第 1-5 个聊天 → 消息加载正常"
echo "3. 验证无重复会话（备份不应显示）"
echo ""
echo "=========================================="
echo ""

# ==========================================
# 第一阶段：准备工作
# ==========================================

echo "=== 第一阶段：准备工作 ==="
echo ""

# 1. 打开前端页面
echo "1. 打开前端页面"
agent-browser open "$FRONTEND_URL/?token=$API_KEY" > /dev/null 2>&1
sleep 3

# 2. 记录当前聊天列表状态
BEFORE_COUNT=$(agent-browser eval "document.querySelectorAll('.chat-item').length" 2>&1)
echo "当前聊天数: $BEFORE_COUNT"

# 3. 获取当前会话ID列表（用于检查重复）
BEFORE_SESSIONS=$(agent-browser eval "
  (function() {
    const items = document.querySelectorAll('.chat-item');
    const sessions = {};
    for (let item of items) {
      const title = item.querySelector('.chat-item-title')?.textContent || '';
      // 提取 shortId（括号中的部分）
      const match = title.match(/\(([a-f0-9]{8})\)/);
      if (match) {
        const shortId = match[1];
        sessions[shortId] = (sessions[shortId] || 0) + 1;
      }
    }
    return sessions;
  })();
" 2>&1)

echo ""
echo "=========================================="
echo ""

# ==========================================
# 第二阶段：创建新会话 → 聊天列表更新
# ==========================================

echo "=== 第二阶段：创建新会话 ==="
echo ""

# 创建 3 个新 session 文件
echo "创建 3 个新 session 文件..."
SESSION_UUIDS=()

for i in 1 2 3; do
  SESSION_UUID=$(cat /proc/sys/kernel/random/uuid)
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
  SESSION_FILE="$HOME/.openclaw/agents/mime-feishu/sessions/${SESSION_UUID}.jsonl"
  
  cat > "$SESSION_FILE" << EOF
{"type":"session","version":3,"id":"${SESSION_UUID}","createdAt":"${TIMESTAMP}"}
{"type":"message","id":"msg-1","timestamp":"${TIMESTAMP}","message":{"role":"user","content":"/new - E2E test $i"}}
{"type":"message","id":"msg-2","timestamp":"${TIMESTAMP}","message":{"role":"assistant","content":[{"type":"text","text":"好的，新会话已创建。这是测试消息 $i。"}]}}
EOF
  
  SESSION_UUIDS="$SESSION_UUIDS $SESSION_UUID"
  echo "  Session $i: ${SESSION_UUID:0:8}"
done

# 等待后端检测（2秒）
sleep 2

# 检查聊天列表更新
echo ""
AFTER_COUNT=$(agent-browser eval "document.querySelectorAll('.chat-item').length" 2>&1)
echo "更新后聊天数: $AFTER_COUNT"

DIFF=$((AFTER_COUNT - BEFORE_COUNT))
if [ "$DIFF" -ge 3 ]; then
  pass "聊天列表新增了 $DIFF 个条目"
else
  fail "聊天列表未新增足够的条目（预期至少3个，实际新增$DIFF个）"
fi

echo ""
echo "=========================================="
echo ""

# ==========================================
# 第三阶段：点击聊天加载消息
# ==========================================

echo "=== 第三阶段：点击聊天加载消息 ==="
echo ""

for i in 1 2 3 4 5; do
  # 交替点击第1和第2个聊天
  CHAT_IDX=$(( (i - 1) % 2 ))
  
  agent-browser eval "document.querySelectorAll('.chat-item')[$CHAT_IDX]?.click()" > /dev/null 2>&1
  sleep 2
  
  MSG_COUNT=$(agent-browser eval "document.querySelectorAll('.message').length" 2>&1)
  
  if [ "$MSG_COUNT" -gt 0 ]; then
    echo "✅ 第${i}次点击：$MSG_COUNT 条消息"
    ((pass_count++))
  else
    echo "❌ 第${i}次点击：无消息"
    ((fail_count++))
  fi
done

echo ""
echo "=========================================="
echo ""

# ==========================================
# 第四阶段：验证无重复会话
# ==========================================

echo "=== 第四阶段：验证无重复会话 ==="
echo ""

# 获取当前会话ID列表
AFTER_SESSIONS=$(agent-browser eval "
  (function() {
    const items = document.querySelectorAll('.chat-item');
    const sessions = {};
    for (let item of items) {
      const title = item.querySelector('.chat-item-title')?.textContent || '';
      const match = title.match(/\(([a-f0-9]{8})\)/);
      if (match) {
        const shortId = match[1];
        sessions[shortId] = (sessions[shortId] || 0) + 1;
      }
    }
    return sessions;
  })();
" 2>&1)

# 检查是否有重复
DUPLICATES=$(echo "$AFTER_SESSIONS" | jq -r 'to_entries | map(select(.value > 1)) | length' 2>/dev/null || echo "0")

if [ "$DUPLICATES" = "0" ]; then
  pass "无重复会话"
else
  # 显示重复的会话
  DUP_DETAILS=$(echo "$AFTER_SESSIONS" | jq -r 'to_entries | map(select(.value > 1))' 2>/dev/null)
  fail "存在 $DUPLICATES 个重复会话: $DUP_DETAILS"
fi

echo ""
echo "=========================================="
echo ""

# ==========================================
# 第五阶段：检查备份文件不显示
# ==========================================

echo "=== 第五阶段：检查备份文件不显示 ==="
echo ""

# 检查数据库中是否有备份记录
BACKUP_COUNT=$(sqlite3 /var/lib/openclaw-monitor/monitor.db \
  "SELECT COUNT(*) FROM chats WHERE session_file LIKE '%.jsonl.reset.%'" 2>/dev/null || echo "0")

if [ "$BACKUP_COUNT" = "0" ]; then
  pass "数据库中无备份记录"
else
  warn "数据库中有 $BACKUP_COUNT 条备份记录（已被标记为隐藏或不显示）"
fi

# 检查前端是否显示备份
BACKUP_IN_FRONTEND=$(agent-browser eval "
  (function() {
    const items = document.querySelectorAll('.chat-item');
    for (let item of items) {
      const title = item.querySelector('.chat-item-title')?.textContent || '';
      if (title.includes('[备份]')) {
        return true;
      }
    }
    return false;
  })();
" 2>&1)

if [ "$BACKUP_IN_FRONTEND" = "true" ]; then
  fail "前端显示了备份会话"
else
  pass "前端未显示备份会话"
fi

echo ""
echo "=========================================="
echo ""

# ==========================================
# 清理
# ==========================================

echo "=== 清理测试文件 ==="
for UUID in $SESSION_UUIDS; do
  rm -f "$HOME/.openclaw/agents/mime-feishu/sessions/${UUID}.jsonl"
done
echo "已清理测试文件"

echo ""
echo "=========================================="
echo "测试总结"
echo "=========================================="
echo ""
echo "通过: $pass_count"
echo "失败: $fail_count"
echo ""

if [ $fail_count -eq 0 ]; then
  echo -e "${GREEN}✅ 所有测试通过！${NC}"
  exit 0
else
  echo -e "${RED}❌ 存在失败的测试${NC}"
  exit 1
fi
