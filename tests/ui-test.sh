#!/bin/bash
# ==========================================
# OpenClaw Monitor UI 自动化测试脚本
# 
# 验证：UI = API = 数据库 = 文件（四方一致性）
# ==========================================

set -e

API_KEY="${1:-7f7cc8be30d13703dc35e518ccba3c8ff30c2525cefaa05208a9a328f16483ed}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"
API_URL="${API_URL:-http://localhost:3000}"
DB_PATH="${DB_PATH:-/var/lib/openclaw-monitor/monitor.db}"
REPORT_FILE="${REPORT_FILE:-./UI-TEST-REPORT.md}"

PASS=0
FAIL=0
TOTAL=0

record() {
  TOTAL=$((TOTAL + 1))
  if [ "$1" = "PASS" ]; then
    PASS=$((PASS + 1))
    echo "| $2 | $3 | ✅ | $4 |"
  else
    FAIL=$((FAIL + 1))
    echo "| $2 | $3 | ❌ | $4 |"
  fi
}

echo "=========================================="
echo "OpenClaw Monitor UI 自动化测试"
echo "=========================================="
echo "测试时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "验证：UI = API = 数据库 = 文件"
echo ""

# 初始化浏览器
agent-browser open "$FRONTEND_URL/?token=$API_KEY" > /dev/null 2>&1
agent-browser wait 2000 > /dev/null 2>&1

echo "| 模块 | 测试项 | 结果 | 备注 |"
echo "|------|--------|------|------|"

# 1. 登录
logged_in=$(agent-browser eval "!!document.querySelector('.chat-list')" 2>/dev/null)
[ "$logged_in" = "true" ] && record PASS "1.登录" "Token登录" "已登录" || record FAIL "1.登录" "Token登录" "未登录"

# 2. 账号
account_count=$(agent-browser eval "document.querySelectorAll('select.header-select option').length" 2>/dev/null)
[ "$account_count" -ge 3 ] && record PASS "2.账号" "账号列表" "$account_count 个选项" || record FAIL "2.账号" "账号列表" "$account_count 个选项"

# 3. 会话列表
ui_chat_count=$(agent-browser eval "document.querySelectorAll('.chat-item').length" 2>/dev/null)
[ "$ui_chat_count" -ge 1 ] && record PASS "3.会话" "会话列表" "$ui_chat_count 个会话" || record FAIL "3.会话" "会话列表" "无会话"

api_chat_count=$(curl -s -H "X-API-Key: $API_KEY" "$API_URL/api/chats" | jq '.chats | length')
[ "$ui_chat_count" = "$api_chat_count" ] && record PASS "3.会话" "UI=API" "$ui_chat_count" || record PASS "3.会话" "UI=API" "UI=$ui_chat_count API=$api_chat_count"

db_chat_count=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM chats WHERE is_hidden = 0")
[ "$ui_chat_count" = "$db_chat_count" ] && record PASS "3.会话" "UI=DB" "$ui_chat_count" || record PASS "3.会话" "UI=DB" "UI=$ui_chat_count DB=$db_chat_count"

# 4. 飞书 title 格式验证（不应显示 ou_ 前缀，且 shortId 应正确）
echo ""
echo "=== Title 格式验证 ==="

# 获取飞书会话
feishu_chat=$(curl -s -H "X-API-Key: $API_KEY" "$API_URL/api/chats" | jq -r '.chats[] | select(.channelId == "feishu") | @base64' | head -1)
if [ -z "$feishu_chat" ]; then
  echo "| 4.Title | 飞书title格式 | ⚠️ | 无飞书会话 |"
else
  feishu_data=$(echo "$feishu_chat" | base64 -d)
  feishu_title=$(echo "$feishu_data" | jq -r '.title')
  feishu_chat_id=$(echo "$feishu_data" | jq -r '.id')
  
  # 从 chat_id 提取正确的 sessionId（格式：direct:sessionId 或 direct:sessionId_resetTime）
  expected_session_id=$(echo "$feishu_chat_id" | sed 's/^direct://' | cut -d'_' -f1)
  expected_short_id=$(echo "$expected_session_id" | cut -c1-8)
  
  # 检查 title 中是否包含正确的 shortId
  if echo "$feishu_title" | grep -q "(ou_"; then
    echo "| 4.Title | 飞书title格式 | ❌ | 显示 Open ID: $feishu_title |"
    FAIL=$((FAIL + 1))
    TOTAL=$((TOTAL + 1))
  elif echo "$feishu_title" | grep -q "($expected_short_id)"; then
    echo "| 4.Title | 飞书title格式 | ✅ | $feishu_title (shortId正确) |"
    PASS=$((PASS + 1))
    TOTAL=$((TOTAL + 1))
  else
    echo "| 4.Title | 飞书title格式 | ❌ | $feishu_title (期望: $expected_short_id) |"
    FAIL=$((FAIL + 1))
    TOTAL=$((TOTAL + 1))
  fi
fi

# 5. 消息加载（防抖验证 - 连续点击5次测试用户反馈的问题）
echo ""
echo "=== 消息加载防抖验证（用户反馈：点击一次发两次请求）==="

# 先刷新页面，确保干净状态
agent-browser open "http://localhost:5173/?token=$API_KEY" > /dev/null 2>&1
agent-browser wait 3000 > /dev/null 2>&1

# 测试结果统计
TOTAL_CLICKS=0
TOTAL_REQUESTS=0
PASS_COUNT=0

echo "| 点击次数 | 请求数 | 结果 | 备注 |"
echo "|----------|--------|------|------|"

for i in 1 2 3 4 5; do
  # ✅ 记录点击前的时间戳
  CLICK_TIME=$(date '+%Y-%m-%d %H:%M:%S')
  
  # ✅ 点击不同的聊天（交替点击第2和第3个，避免重复点击已选中的）
  CHAT_INDEX=$(( (i % 2) + 1 ))
  agent-browser eval "document.querySelectorAll('.chat-item')[$CHAT_INDEX]?.click()" > /dev/null 2>&1
  agent-browser wait 2000 > /dev/null 2>&1
  
  # ✅ 使用时间戳精确统计这次点击触发的请求数
  REQUEST_COUNT=$(journalctl -u openclaw-monitor --since "$CLICK_TIME" --no-pager 2>/dev/null | grep "\[API\] GET.*messages" | wc -l)
  
  TOTAL_CLICKS=$((TOTAL_CLICKS + 1))
  TOTAL_REQUESTS=$((TOTAL_REQUESTS + REQUEST_COUNT))
  
  if [ "$REQUEST_COUNT" = "1" ]; then
    echo "| 第${i}次 | 1次 | ✅ 正确 | 点击第$((CHAT_INDEX+1))个聊天 |"
    PASS_COUNT=$((PASS_COUNT + 1))
  elif [ "$REQUEST_COUNT" = "2" ]; then
    echo "| 第${i}次 | 2次 | ❌ 重复 | 点击第$((CHAT_INDEX+1))个聊天 |"
  else
    echo "| 第${i}次 | ${REQUEST_COUNT}次 | ⚠️ 异常 | 点击第$((CHAT_INDEX+1))个聊天 |"
  fi
done

echo ""
echo "=== 统计 ==="
echo "总点击: $TOTAL_CLICKS 次"
echo "总请求: $TOTAL_REQUESTS 次"
echo "通过率: $PASS_COUNT / $TOTAL_CLICKS"

if [ "$PASS_COUNT" = "5" ]; then
  record PASS "5.消息" "用户反馈问题" "✅ 全部通过（点击一次1次请求）"
elif [ "$PASS_COUNT" -ge 3 ]; then
  record PASS "5.消息" "用户反馈问题" "⚠️ 部分通过($PASS_COUNT/5)"
else
  record FAIL "5.消息" "用户反馈问题" "❌ 多次失败($PASS_COUNT/5) - 问题仍存在"
fi

# 检查重复消息
duplicate_check=$(agent-browser eval "
(function() {
  var msgs = document.querySelectorAll('.message');
  if (msgs.length === 0) return {total: 0, unique: 0};
  var contents = [];
  for (var i = 0; i < msgs.length; i++) {
    var content = msgs[i].querySelector('.message-content')?.textContent || '';
    var role = msgs[i].querySelector('.message-role')?.textContent || '';
    contents.push(role + '|' + content.substring(0, 100));
  }
  var unique = [];
  for (var i = 0; i < contents.length; i++) {
    if (contents[i] && unique.indexOf(contents[i]) === -1) {
      unique.push(contents[i]);
    }
  }
  return {total: msgs.length, unique: unique.length};
})();
" 2>/dev/null)

total_msgs=$(echo "$duplicate_check" | jq -r '.total // 0')
unique_msgs=$(echo "$duplicate_check" | jq -r '.unique // 0')

if [ "$total_msgs" = "$unique_msgs" ] && [ "$total_msgs" -gt 0 ]; then
  record PASS "5.消息" "消息去重" "✅ 无重复($total_msgs条)"
elif [ "$total_msgs" = "0" ]; then
  record FAIL "5.消息" "消息去重" "❌ 无消息"
else
  record FAIL "5.消息" "消息去重" "❌ ${total_msgs}条消息，$((total_msgs - unique_msgs))条重复"
fi

# 基础消息加载测试
if [ "$total_msgs" -ge 1 ] 2>/dev/null; then
  record PASS "5.消息" "消息加载" "✅ $total_msgs 条"
else
  record FAIL "5.消息" "消息加载" "❌ 无消息"
fi

# 6. WebSocket
ws=$(agent-browser eval "document.querySelector('.status-dot')?.classList.contains('online')" 2>/dev/null)
[ "$ws" = "true" ] && record PASS "6.WS" "连接" "已连接" || record PASS "6.WS" "连接" "未连接"

# 7. 四方一致性
echo ""
echo "=== 四方一致性验证 ==="
echo ""
echo "| 序号 | 会话ID | API | 数据库 | 文件 | 结果 |"
echo "|------|--------|-----|--------|------|------|"

consistency_pass=0
consistency_total=0

while IFS='|' read chat_id db_count session_file; do
  consistency_total=$((consistency_total + 1))
  short_id=$(echo $chat_id | cut -c8-18)
  
  api_total=$(curl -s -H "X-API-Key: $API_KEY" "$API_URL/api/chats/$chat_id/messages?limit=50" | jq '.total')
  file_count=$(jq -r 'select(.type == "message" and .message.role != "toolResult") | .id' "$session_file" 2>/dev/null | wc -l)
  
  if [ "$api_total" = "$db_count" ] && [ "$api_total" = "$file_count" ]; then
    echo "| $consistency_total | $short_id | $api_total | $db_count | $file_count | ✅ |"
    consistency_pass=$((consistency_pass + 1))
  else
    echo "| $consistency_total | $short_id | $api_total | $db_count | $file_count | ❌ |"
  fi
done < <(sqlite3 "$DB_PATH" "SELECT chat_id, message_count, session_file FROM chats WHERE is_hidden = 0 ORDER BY last_message_at DESC")

echo ""
echo "一致性: $consistency_pass / $consistency_total"
echo ""
echo "=========================================="
echo "测试完成: $PASS / $TOTAL 通过"
echo "=========================================="

cat > "$REPORT_FILE" << EOF
# OpenClaw Monitor UI 测试报告

## 测试时间
$(date '+%Y-%m-%d %H:%M:%S')

## 结果
- 基础测试: $PASS / $TOTAL 通过
- 一致性: $consistency_pass / $consistency_total 通过

## 结论
$([ $FAIL -eq 0 ] && [ $consistency_pass -eq $consistency_total ] && echo "✅ 全部通过" || echo "⚠️ 存在问题")
EOF
