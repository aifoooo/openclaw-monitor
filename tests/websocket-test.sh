#!/bin/bash
# WebSocket 端到端测试
# 测试流程：后端检测消息 → WebSocket 广播 → 前端接收

set -e

API_KEY="${1:-7f7cc8be30d13703dc35e518ccba3c8ff30c2525cefaa05208a9a328f16483ed}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"

echo "=========================================="
echo "WebSocket 端到端测试"
echo "=========================================="
echo ""

# 1. 检查后端 WebSocket 服务
echo "=== 1. 检查后端 WebSocket 服务 ==="
WS_CONNECTIONS=$(journalctl -u openclaw-monitor -n 100 --no-pager 2>/dev/null | grep "Connection added" | tail -1 | grep -oP 'total: \K\d+' || echo "0")
echo "当前 WebSocket 连接数: $WS_CONNECTIONS"

# 如果没有连接，自动打开前端页面
if [ "$WS_CONNECTIONS" -eq 0 ]; then
  echo "⚠️ 没有活跃的 WebSocket 连接，正在打开前端页面..."
  
  agent-browser open "$FRONTEND_URL/?token=$API_KEY" > /dev/null 2>&1
  sleep 5
  
  # 再次检查
  WS_CONNECTIONS=$(journalctl -u openclaw-monitor -n 20 --no-pager 2>/dev/null | grep "Connection added" | tail -1 | grep -oP 'total: \K\d+' || echo "0")
  
  if [ "$WS_CONNECTIONS" -eq 0 ]; then
    echo "❌ 无法建立 WebSocket 连接"
    exit 1
  fi
fi

echo "✅ 后端 WebSocket 服务正常 (连接数: $WS_CONNECTIONS)"
echo ""

# 2. 注入 WebSocket 监听器
echo "=== 2. 注入 WebSocket 监听器 ==="

# 使用 heredoc 避免转义问题
cat > /tmp/ws-test.js << 'JSEOF'
(function() {
  const token = localStorage.getItem('api_token');
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const wsUrl = protocol + '//' + host + '/ws?token=' + token;
  
  console.log('[Test WS] Connecting to:', wsUrl.replace(/token=[^&]+/, 'token=***'));
  
  const ws = new WebSocket(wsUrl);
  
  window.receivedMessages = [];
  
  ws.onopen = () => {
    console.log('[Test WS] Connected');
    window.testWsConnected = true;
  };
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('[Test WS] Received:', data.type, data);
    window.receivedMessages.push({
      type: data.type,
      time: Date.now(),
      seq: data.seq
    });
  };
  
  ws.onerror = (error) => {
    console.error('[Test WS] Error:', error);
  };
  
  ws.onclose = () => {
    console.log('[Test WS] Closed');
  };
  
  window.testWs = ws;
  
  return { 
    wsCreated: true, 
    url: wsUrl.replace(/token=[^&]+/, 'token=***'),
    readyState: ws.readyState
  };
})();
JSEOF

agent-browser eval "$(cat /tmp/ws-test.js)" 2>&1
sleep 3

# 检查 WebSocket 连接状态
WS_STATE=$(agent-browser eval "window.testWs ? window.testWs.readyState : -1" 2>&1)
if [ "$WS_STATE" = "1" ]; then
  echo "✅ WebSocket 已连接 (OPEN)"
else
  echo "❌ WebSocket 未连接 (state: $WS_STATE)"
  echo "状态说明: 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED"
  exit 1
fi
echo ""

# 3. 模拟新消息
echo "=== 3. 模拟新消息 ==="
TEST_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
echo "开始时间: $TEST_TIMESTAMP"

# 使用现有的会话文件，追加一条测试消息
TEST_SESSION="$HOME/.openclaw/agents/mime-qq/sessions/af0f64db-bc37-4e8f-92c7-819e2096e283.jsonl"
TEST_MESSAGE_ID="test-$(date +%s)"

echo "{\"type\":\"message\",\"id\":\"$TEST_MESSAGE_ID\",\"timestamp\":\"$TEST_TIMESTAMP\",\"message\":{\"role\":\"user\",\"content\":\"WebSocket test\"}}" >> "$TEST_SESSION"

echo "测试消息 ID: $TEST_MESSAGE_ID"
echo ""

# 4. 等待后端检测和广播
echo "=== 4. 等待后端检测（最多 10 秒）==="
DETECTED=false
for i in {1..10}; do
  if journalctl -u openclaw-monitor --since "$TEST_TIMESTAMP" --no-pager 2>/dev/null | grep -q "New message"; then
    echo "✅ 后端检测到新消息 (第 $i 秒)"
    DETECTED=true
    break
  fi
  sleep 1
done

if [ "$DETECTED" = false ]; then
  echo "⚠️ 后端未检测到新消息"
fi
echo ""

# 5. 检查前端是否收到 WebSocket 消息
echo "=== 5. 检查前端收到的消息 ==="
sleep 2

RECEIVED_COUNT=$(agent-browser eval "window.receivedMessages ? window.receivedMessages.length : 0" 2>&1)
echo "前端收到的消息数: $RECEIVED_COUNT"

if [ "$RECEIVED_COUNT" -gt 0 ]; then
  echo ""
  echo "收到的消息列表:"
  agent-browser eval "JSON.stringify(window.receivedMessages, null, 2)" 2>&1 | head -20
  
  echo ""
  echo "✅ WebSocket 端到端测试成功！"
  
  # 检查是否收到 new_message
  NEW_MSG_COUNT=$(agent-browser eval "window.receivedMessages.filter(m => m.type === 'new_message').length" 2>&1)
  if [ "$NEW_MSG_COUNT" -gt 0 ]; then
    echo "✅ 收到 $NEW_MSG_COUNT 条 new_message 事件"
  fi
else
  echo ""
  echo "❌ 前端未收到任何 WebSocket 消息"
  echo ""
  echo "=== 诊断信息 ==="
  echo "1. 后端日志（最近 10 秒）:"
  journalctl -u openclaw-monitor --since "$TEST_TIMESTAMP" --no-pager 2>/dev/null | grep -E "Broadcasting|new_message|test-" | tail -10
  
  echo ""
  echo "2. WebSocket 连接状态:"
  agent-browser eval "{ readyState: window.testWs.readyState, url: window.testWs.url }" 2>&1
fi

echo ""
echo "=========================================="
echo "测试完成"
echo "=========================================="
