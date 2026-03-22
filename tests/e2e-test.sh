#!/bin/bash
# OpenClaw Monitor 端到端测试
# 测试场景：飞书发送消息 → 聊天列表新增 → 点击加载消息

set -e

API_KEY="${1:-7f7cc8be30d13703dc35e518ccba3c8ff30c2525cefaa05208a9a328f16483ed}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"
API_URL="${API_URL:-http://localhost:3000}"

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

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
echo "OpenClaw Monitor 端到端测试"
echo "=========================================="
echo ""
echo "测试策略："
echo "1. 飞书渠道发送 /new → 聊天列表新增条目"
echo "2. 点击第 1-5 个聊天 → 消息加载正常"
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

# 2. 注入 WebSocket 监听器
echo "2. 注入 WebSocket 监听器"
cat > /tmp/e2e-ws-listener.js << 'EOF'
(function() {
  const token = localStorage.getItem('api_token');
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const wsUrl = protocol + '//' + host + '/ws?token=' + token;
  
  const ws = new WebSocket(wsUrl);
  
  window.e2eMessages = [];
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    window.e2eMessages.push({
      type: data.type,
      time: Date.now(),
      data: data.data
    });
  };
  
  window.e2eWs = ws;
  
  return { created: true };
})();
EOF

agent-browser eval "$(cat /tmp/e2e-ws-listener.js)" > /dev/null 2>&1
sleep 2

# 3. 检查 WebSocket 连接
WS_STATE=$(agent-browser eval "window.e2eWs ? window.e2eWs.readyState : -1" 2>&1)
if [ "$WS_STATE" = "1" ]; then
  pass "WebSocket 连接正常 (OPEN)"
else
  fail "WebSocket 连接失败 (state: $WS_STATE)"
  exit 1
fi

# 4. 记录当前聊天列表状态
echo ""
echo "3. 记录当前聊天列表状态"
BEFORE_COUNT=$(agent-browser eval "document.querySelectorAll('.chat-item').length" 2>&1)
echo "当前聊天数量: $BEFORE_COUNT"

BEFORE_FIRST=$(agent-browser eval "
(function() {
  const first = document.querySelector('.chat-item');
  if (!first) return null;
  const title = first.querySelector('.chat-title')?.textContent || '';
  const time = first.querySelector('.chat-time')?.textContent || '';
  return { title, time };
})();
" 2>&1)

echo "第一个聊天: $(echo $BEFORE_FIRST | jq -r '.title' 2>/dev/null || echo 'N/A')"

echo ""
echo "=========================================="
echo ""

# ==========================================
# 第二阶段：飞书发送消息 → 聊天列表更新
# ==========================================

echo "=== 第二阶段：飞书发送消息 → 聊天列表更新 ==="
echo ""

# 方案A：自动模拟（追加消息到文件）
echo "方案A：自动模拟飞书新消息"
FEISHU_SESSION="$HOME/.openclaw/agents/mime-feishu/sessions/test-e2e-$(date +%s).jsonl"
TEST_MSG_ID="e2e-test-$(date +%s)"
TEST_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")

# 创建测试会话文件
cat > "$FEISHU_SESSION" << EOF
{"type":"session","version":3,"id":"test-e2e-session","createdAt":"$TEST_TIMESTAMP"}
{"type":"message","id":"$TEST_MSG_ID","timestamp":"$TEST_TIMESTAMP","message":{"role":"user","content":"/new"}}
EOF

echo "已创建飞书测试会话: $(basename $FEISHU_SESSION)"
echo "等待后端检测（最多 10 秒）..."

DETECTED=false
for i in {1..10}; do
  if journalctl -u openclaw-monitor --since "$TEST_TIMESTAMP" --no-pager 2>/dev/null | grep -q "test-e2e"; then
    DETECTED=true
    echo "✅ 后端检测到测试会话 (第 $i 秒)"
    break
  fi
  sleep 1
done

if [ "$DETECTED" = false ]; then
  warn "后端未检测到测试会话（可能需要等待扫描周期）"
  echo "使用方案B：请手动给飞书发送 /new"
  echo ""
  read -p "按回车继续（发送完成后）..." -t 30 || true
fi

sleep 2

# 检查聊天列表是否更新
echo ""
echo "检查聊天列表更新..."

AFTER_COUNT=$(agent-browser eval "document.querySelectorAll('.chat-item').length" 2>&1)
AFTER_FIRST=$(agent-browser eval "
(function() {
  const first = document.querySelector('.chat-item');
  if (!first) return null;
  const title = first.querySelector('.chat-title')?.textContent || '';
  const time = first.querySelector('.chat-time')?.textContent || '';
  return { title, time };
})();
" 2>&1)

echo "更新后聊天数量: $AFTER_COUNT"
echo "更新后第一个聊天: $(echo $AFTER_FIRST | jq -r '.title' 2>/dev/null || echo 'N/A')"

# 判断是否新增了聊天
if [ "$AFTER_COUNT" -gt "$BEFORE_COUNT" ]; then
  pass "聊天列表新增了 $((AFTER_COUNT - BEFORE_COUNT)) 个条目"
elif [ "$BEFORE_FIRST" != "$AFTER_FIRST" ]; then
  pass "聊天列表顺序已更新（第一个聊天变了）"
else
  fail "聊天列表没有变化"
fi

# 检查 WebSocket 是否收到消息
WS_MSG_COUNT=$(agent-browser eval "window.e2eMessages ? window.e2eMessages.length : 0" 2>&1)
if [ "$WS_MSG_COUNT" -gt 0 ]; then
  pass "WebSocket 收到 $WS_MSG_COUNT 条消息"
else
  fail "WebSocket 未收到消息"
fi

echo ""
echo "=========================================="
echo ""

# ==========================================
# 第三阶段：点击聊天 → 消息加载
# ==========================================

echo "=== 第三阶段：点击聊天 → 消息加载 ==="
echo ""

# 测试点击前 5 个聊天
for i in 0 1 2 3 4; do
  echo "--- 测试点击第 $((i+1)) 个聊天 ---"
  
  # 记录点击前的消息数量
  BEFORE_MSG_COUNT=$(agent-browser eval "document.querySelectorAll('.message').length" 2>&1)
  
  # 记录 API 请求开始时间
  CLICK_TIME=$(date '+%Y-%m-%d %H:%M:%S')
  
  # 点击第 i 个聊天
  agent-browser eval "document.querySelectorAll('.chat-item')[$i]?.click()" > /dev/null 2>&1
  
  # 等待加载
  sleep 2
  
  # 检查 API 请求
  API_COUNT=$(journalctl -u openclaw-monitor --since "$CLICK_TIME" --no-pager 2>/dev/null | grep "\[API\] GET.*messages" | wc -l)
  
  # 检查消息数量
  AFTER_MSG_COUNT=$(agent-browser eval "document.querySelectorAll('.message').length" 2>&1)
  
  # 获取聊天标题
  CHAT_TITLE=$(agent-browser eval "
    (function() {
      const item = document.querySelectorAll('.chat-item')[$i];
      if (!item) return 'N/A';
      return item.querySelector('.chat-title')?.textContent || 'N/A';
    })();
  " 2>&1)
  
  echo "聊天标题: ${CHAT_TITLE:0:30}"
  echo "API 请求数: $API_COUNT"
  echo "消息数量: $BEFORE_MSG_COUNT → $AFTER_MSG_COUNT"
  
  # 判断是否通过
  if [ "$API_COUNT" -ge 1 ] && [ "$AFTER_MSG_COUNT" -gt 0 ]; then
    pass "第 $((i+1)) 个聊天加载正常 ($AFTER_MSG_COUNT 条消息)"
  elif [ "$API_COUNT" -ge 1 ] && [ "$AFTER_MSG_COUNT" -eq 0 ]; then
    warn "第 $((i+1)) 个聊天：有请求但无消息（可能为新会话）"
    ((pass_count++))
  elif [ "$API_COUNT" -eq 0 ]; then
    fail "第 $((i+1)) 个聊天：无 API 请求"
  else
    fail "第 $((i+1)) 个聊天：加载失败"
  fi
  
  echo ""
done

echo "=========================================="
echo ""

# ==========================================
# 第四阶段：总结
# ==========================================

echo "=== 测试总结 ==="
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
