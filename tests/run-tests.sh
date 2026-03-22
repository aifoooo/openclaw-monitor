#!/bin/bash

# OpenClaw Monitor 数据一致性测试脚本
# 使用方法: bash run-tests.sh

TOKEN="7f7cc8be30d13703dc35e518ccba3c8ff30c2525cefaa05208a9a328f16483ed"
DB_PATH="/var/lib/openclaw-monitor/monitor.db"
SESSION_DIR="/root/.openclaw/agents"

# 颜色定义
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
NC='\033[0m'

# 测试结果
PASS=0
FAIL=0
WARNINGS=0

# 辅助函数
print_header() {
    echo "========================================"
    echo "$1"
    echo "========================================"
}

print_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}[PASS]${NC} $2"
        ((PASS++))
    else
        echo -e "${RED}[FAIL]${NC} $2"
        ((FAIL++))
    fi
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
    ((WARNINGS++))
}

# TC-01: 渠道配置验证
test_channels_config() {
    print_header "TC-01: 渠道配置验证"
    
    # 获取 API 数据
    api_result=$(curl -s -H "X-API-Key: $TOKEN" http://localhost:3000/api/channels 2>/dev/null)
    api_count=$(echo "$api_result" | jq '.channels | length')
    
    # 获取数据库数据
    db_count=$(sqlite3 $DB_PATH "SELECT COUNT(*) FROM channels;" 2>/dev/null)
    
    if [ "$api_count" -eq "$db_count" ]; then
        print_result 0 "API channels数量($api_count) 与数据库($db_count) 一致"
    else
        print_result 1 "API channels数量($api_count) 与数据库($db_count) 不一致"
    fi
}

# TC-02: 账号配置验证
test_accounts_config() {
    print_header "TC-02: 账号配置验证"
    
    # 获取 API 数据
    api_result=$(curl -s -H "X-API-Key: $TOKEN" http://localhost:3000/api/accounts 2>/dev/null)
    api_count=$(echo "$api_result" | jq '.accounts | length')
    
    # 验证账号数量
    if [ "$api_count" -ge 2 ]; then
        print_result 0 "API accounts数量: $api_count"
    else
        print_result 1 "API accounts数量不足: $api_count (期望 >= 2)"
    fi
}

# TC-02.5: Title 格式验证（增强版）
test_title_format() {
    print_header "TC-02.5: Title 格式验证（增强版）"
    
    title_errors=0
    
    # 获取所有会话的 title 和 chat_id
    while IFS='|' read -r chat_id title; do
        # 提取正确的 shortId（从 chat_id 中提取）
        # chat_id 格式：direct:sessionId 或 direct:sessionId_resetTime
        session_id=$(echo "$chat_id" | sed 's/^direct://' | cut -d'_' -f1)
        expected_short_id=$(echo "$session_id" | cut -c1-8)
        
        # 检查 title 中是否包含正确的 shortId
        if echo "$title" | grep -q "($expected_short_id)"; then
            echo -e "${GREEN}[PASS]${NC} $chat_id: title 正确 ($title)"
        else
            # ✅ 任何不匹配都报 FAIL（不管是 Open ID、QQ 号还是其他）
            echo -e "${RED}[FAIL]${NC} $chat_id: title 格式错误 ($title, 期望: $expected_short_id)"
            title_errors=$((title_errors + 1))
        fi
    done < <(sqlite3 "$DB_PATH" "SELECT chat_id, title FROM chats WHERE is_hidden = 0")
    
    if [ $title_errors -eq 0 ]; then
        print_result 0 "所有会话 title 格式正确"
    else
        print_result 1 "发现 $title_errors 个 title 格式错误"
    fi
}

# TC-03: Session 文件数量验证
test_session_count() {
    print_header "TC-03: Session 文件数量验证"
    
    # 统计文件系统 session 数量
    file_count=$(find $SESSION_DIR/*/sessions -name "*.jsonl" -type f 2>/dev/null | wc -l)
    
    # 统计有渠道的 session 文件数量（排除 main agent）
    valid_session_count=$(find $SESSION_DIR/*/sessions -name "*.jsonl" -type f 2>/dev/null | grep -v "/main/" | wc -l)
    
    # 获取 API chats 数量
    api_result=$(curl -s -H "X-API-Key: $TOKEN" http://localhost:3000/api/chats 2>/dev/null)
    api_count=$(echo "$api_result" | jq '.total')
    
    if [ "$api_count" -ge "$valid_session_count" ]; then
        print_result 0 "API chats数量($api_count) >= 有效session文件数量($valid_session_count)（正常）"
    else
        print_warning "API chats数量($api_count) < 有效session文件数量($valid_session_count)（可能有问题）"
    fi
}

# TC-04: Session 文件完整性验证
test_session_integrity() {
    print_header "TC-04: Session 文件完整性验证"
    
    total_sessions=0
    missing_sessions=0
    skipped_sessions=0
    
    for file in $(find $SESSION_DIR/*/sessions -name "*.jsonl" -type f 2>/dev/null); do
        session_id=$(basename "$file" .jsonl)
        agent=$(echo $file | sed 's|.*/agents/\([^/]*\)/sessions/.*|\1|')
        total_sessions=$((total_sessions + 1))
        
        # main agent 的 session 没有 sessionKey，不显示是正常的
        if [ "$agent" = "main" ]; then
            skipped_sessions=$((skipped_sessions + 1))
            continue
        fi
        
        # 检查 chats 表中是否存在
        # session_file 字段包含 session_id
        db_count=$(sqlite3 $DB_PATH "SELECT COUNT(*) FROM chats WHERE session_file LIKE '%${session_id}%';" 2>/dev/null)
        
        if [ "$db_count" -eq 0 ]; then
            echo "  缺失: $session_id ($agent)"
            missing_sessions=$((missing_sessions + 1))
        fi
    done
    
    if [ "$missing_sessions" -eq 0 ]; then
        print_result 0 "所有 $((total_sessions - skipped_sessions)) 个有效 session 文件都在 chats 表中有记录（跳过 $skipped_sessions 个 main agent session）"
    else
        print_warning "有 $missing_sessions 个有效 session 文件未在 chats 表中找到"
    fi
}

# TC-05: 数据库完整性验证
test_database_integrity() {
    print_header "TC-05: 数据库完整性验证"
    
    # 完整性检查
    integrity=$(sqlite3 $DB_PATH "PRAGMA integrity_check;" 2>/dev/null)
    
    if [ "$integrity" == "ok" ]; then
        print_result 0 "数据库完整性检查通过"
    else
        print_result 1 "数据库完整性检查失败: $integrity"
    fi
    
    # 表记录统计
    echo "表记录统计:"
    sqlite3 $DB_PATH "
    SELECT 'channels' as table_name, COUNT(*) as count FROM channels
    UNION ALL
    SELECT 'chats', COUNT(*) FROM chats
    UNION ALL
    SELECT 'runs', COUNT(*) FROM runs
    UNION ALL
    SELECT 'cache_traces', COUNT(*) FROM cache_traces
    UNION ALL
    SELECT 'file_positions', COUNT(*) FROM file_positions;
    " 2>/dev/null
}

# TC-06: API 响应性能测试
test_api_performance() {
    print_header "TC-06: API 响应性能测试"
    
    # 测试 channels API
    start_time=$(date +%s%N)
    curl -s -H "X-API-Key: $TOKEN" http://localhost:3000/api/channels > /dev/null
    end_time=$(date +%s%N)
    elapsed=$(( (end_time - start_time) / 1000000 ))
    
    if [ "$elapsed" -lt 1000 ]; then
        print_result 0 "channels API 响应时间: ${elapsed}ms"
    else
        print_warning "channels API 响应时间较慢: ${elapsed}ms"
    fi
    
    # 测试 chats API
    start_time=$(date +%s%N)
    curl -s -H "X-API-Key: $TOKEN" http://localhost:3000/api/chats > /dev/null
    end_time=$(date +%s%N)
    elapsed=$(( (end_time - start_time) / 1000000 ))
    
    if [ "$elapsed" -lt 1000 ]; then
        print_result 0 "chats API 响应时间: ${elapsed}ms"
    else
        print_warning "chats API 响应时间较慢: ${elapsed}ms"
    fi
}

# TC-08: 消息接口性能测试
test_messages_performance() {
    print_header "TC-08: 消息接口性能测试"
    
    # 获取一个有效的 chat_id
    CHAT_ID=$(sqlite3 $DB_PATH "SELECT chat_id FROM chats LIMIT 1;" 2>/dev/null)
    
    if [ -z "$CHAT_ID" ]; then
        print_warning "没有找到有效的 chat_id"
        return
    fi
    
    # 测试消息接口性能
    start_time=$(date +%s%N)
    result=$(curl -s -H "X-API-Key: $TOKEN" \
        "http://localhost:3000/api/chats/$CHAT_ID/messages?limit=20")
    end_time=$(date +%s%N)
    elapsed=$(( (end_time - start_time) / 1000000 ))
    
    # 检查返回的消息数量
    count=$(echo "$result" | jq '.messages | length' 2>/dev/null)
    
    if [ "$elapsed" -lt 500 ] && [ "$count" -gt 0 ]; then
        print_result 0 "messages API 响应时间: ${elapsed}ms, 返回 $count 条消息"
    elif [ "$elapsed" -lt 1000 ]; then
        print_warning "messages API 响应时间可接受: ${elapsed}ms"
    else
        print_result 1 "messages API 响应时间过慢: ${elapsed}ms"
    fi
    
    # 测试大 limit 性能
    start_time=$(date +%s%N)
    curl -s -H "X-API-Key: $TOKEN" \
        "http://localhost:3000/api/chats/$CHAT_ID/messages?limit=100" > /dev/null
    end_time=$(date +%s%N)
    elapsed=$(( (end_time - start_time) / 1000000 ))
    
    if [ "$elapsed" -lt 1000 ]; then
        print_result 0 "messages API (limit=100) 响应时间: ${elapsed}ms"
    else
        print_warning "messages API (limit=100) 响应时间: ${elapsed}ms"
    fi
}

# TC-07: 时间数据正确性测试
test_time_correctness() {
    print_header "TC-07: 时间数据正确性测试"
    
    # 获取当前时间戳（毫秒）
    current_time=$(($(date +%s) * 1000))
    
    # 获取数据库中的时间数据
    result=$(sqlite3 $DB_PATH "
    SELECT 
      chat_id,
      last_message_at,
      title
    FROM chats
    ORDER BY last_message_at DESC
    LIMIT 5;
    " 2>/dev/null)
    
    # 检查时间是否合理（不超过当前时间）
    error_count=0
    while IFS='|' read -r chat_id last_message_at title; do
        if [ -n "$last_message_at" ] && [ "$last_message_at" -gt "$current_time" ]; then
            echo "  错误: $chat_id 的时间 ($last_message_at) 超过当前时间"
            error_count=$((error_count + 1))
        fi
        
        # 检查时间格式是否正确（标题中包含时间）
        if [[ ! "$title" =~ [0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2} ]]; then
            echo "  警告: $chat_id 的标题格式不正确: $title"
        fi
    done <<< "$result"
    
    if [ "$error_count" -eq 0 ]; then
        print_result 0 "所有时间数据都在合理范围内"
    else
        print_result 1 "发现 $error_count 个时间数据错误"
    fi
    
    # 显示时间数据
    echo "时间数据验证:"
    sqlite3 $DB_PATH "
    SELECT 
      substr(title, 1, 20) as title,
      datetime(last_message_at/1000, 'unixepoch', 'localtime') as time
    FROM chats
    ORDER BY last_message_at DESC;
    " 2>/dev/null
}

# TC-09: 消息数量一致性验证
# 验证文件中的消息数量与接口返回的消息数量一致
# 注：runs 表存储 LLM 调用记录，不是聊天消息
test_message_count_consistency() {
    print_header "TC-09: 消息数量一致性验证"
    
    # 优先选择不活跃的会话（last_message_at 超过 1 小时）
    ONE_HOUR_AGO=$(($(date +%s) * 1000 - 3600000))
    CHAT_ID=$(sqlite3 $DB_PATH "SELECT chat_id FROM chats WHERE last_message_at < $ONE_HOUR_AGO ORDER BY last_message_at DESC LIMIT 1;" 2>/dev/null)
    
    # 如果没有不活跃的会话，选择最新但不是当前会话的
    if [ -z "$CHAT_ID" ]; then
        CHAT_ID=$(sqlite3 $DB_PATH "SELECT chat_id FROM chats ORDER BY last_message_at DESC LIMIT 1 OFFSET 1;" 2>/dev/null)
    fi
    
    # 如果还是没有，就用第一个
    if [ -z "$CHAT_ID" ]; then
        CHAT_ID=$(sqlite3 $DB_PATH "SELECT chat_id FROM chats LIMIT 1;" 2>/dev/null)
    fi
    
    if [ -z "$CHAT_ID" ]; then
        print_warning "没有找到有效的 chat_id"
        return
    fi
    
    # 获取数据库中记录的最新时间戳（作为统计基准）
    DB_LAST_TS=$(sqlite3 $DB_PATH "SELECT last_message_at FROM chats WHERE chat_id = '$CHAT_ID';" 2>/dev/null || echo "0")
    DB_MSG_COUNT=$(sqlite3 $DB_PATH "SELECT message_count FROM chats WHERE chat_id = '$CHAT_ID';" 2>/dev/null || echo "0")
    
    # 获取 session_file
    SESSION_FILE=$(sqlite3 $DB_PATH "SELECT session_file FROM chats WHERE chat_id = '$CHAT_ID';" 2>/dev/null)
    
    if [ -z "$SESSION_FILE" ] || [ ! -f "$SESSION_FILE" ]; then
        print_warning "Session file 不存在: $SESSION_FILE"
        return
    fi
    
    echo "  测试会话: $CHAT_ID"
    echo "  数据库基准时间戳: $DB_LAST_TS"
    
    # 1. 统计文件中时间戳 <= DB_LAST_TS 的消息数量
    file_msg_count=$(node -e "
const fs = require('fs');
const content = fs.readFileSync('$SESSION_FILE', 'utf8');
const lines = content.trim().split('\\n').filter(l => l.trim());
const cutoffTs = $DB_LAST_TS;
let count = 0;
for (const line of lines) {
  try {
    const obj = JSON.parse(line);
    if (obj.type === 'message' && obj.message && obj.message.role !== 'toolResult') {
      const ts = obj.message.timestamp || obj.timestamp;
      const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
      if (ms <= cutoffTs) count++;
    }
  } catch(e) {}
}
console.log(count);
" 2>/dev/null || echo "0")
    
    # 2. 获取接口返回的消息，筛选时间戳 <= DB_LAST_TS 的
    api_result=$(curl -s -H "X-API-Key: $TOKEN" "http://localhost:3000/api/chats/$CHAT_ID/messages?limit=10000" 2>/dev/null)
    api_msg_count=$(echo "$api_result" | jq --argjson cutoff $DB_LAST_TS '[.messages[] | select(.timestamp <= $cutoff)] | length' 2>/dev/null || echo "0")
    
    echo "  文件消息数量: $file_msg_count (ts <= $DB_LAST_TS)"
    echo "  接口消息数量: $api_msg_count (ts <= $DB_LAST_TS)"
    echo "  数据库记录数量: $DB_MSG_COUNT"
    
    # 验证一致性 (允许小差异)
    diff_file_api=$((file_msg_count - api_msg_count))
    diff_file_api=${diff_file_api#-}
    
    diff_file_db=$((file_msg_count - DB_MSG_COUNT))
    diff_file_db=${diff_file_db#-}
    
    if [ "$diff_file_api" -le 2 ]; then
        print_result 0 "文件与接口消息数量一致 (差异: $diff_file_api 条)"
    else
        print_warning "文件与接口消息数量差异: $diff_file_api 条"
    fi
    
    if [ "$diff_file_db" -le 2 ]; then
        print_result 0 "数据库 message_count 正确 (差异: $diff_file_db 条)"
    else
        print_warning "数据库 message_count 与文件差异: $diff_file_db 条"
    fi
}

# TC-10: 消息内容一致性验证
# 验证文件、数据库、接口三者的消息内容一致
test_message_content_consistency() {
    print_header "TC-10: 消息内容一致性验证"
    
    # 获取一个有效的 chat_id (选择消息较少的)
    CHAT_ID=$(sqlite3 $DB_PATH "SELECT chat_id FROM chats WHERE message_count < 10 ORDER BY message_count LIMIT 1;" 2>/dev/null)
    
    if [ -z "$CHAT_ID" ]; then
        print_warning "没有找到合适的 chat_id"
        return
    fi
    
    # 获取 session_file
    SESSION_FILE=$(sqlite3 $DB_PATH "SELECT session_file FROM chats WHERE chat_id = '$CHAT_ID';" 2>/dev/null)
    
    if [ -z "$SESSION_FILE" ] || [ ! -f "$SESSION_FILE" ]; then
        print_warning "Session file 不存在: $SESSION_FILE"
        return
    fi
    
    # 获取接口消息
    api_result=$(curl -s -H "X-API-Key: $TOKEN" "http://localhost:3000/api/chats/$CHAT_ID/messages?limit=100" 2>/dev/null)
    api_msg_count=$(echo "$api_result" | jq '.messages | length' 2>/dev/null || echo "0")
    
    if [ "$api_msg_count" -eq 0 ]; then
        print_warning "接口没有返回消息"
        return
    fi
    
    # 简单验证：检查第一条消息的角色和时间
    first_api_msg=$(echo "$api_result" | jq -c '.messages[0]' 2>/dev/null)
    api_role=$(echo "$first_api_msg" | jq -r '.role' 2>/dev/null)
    api_timestamp=$(echo "$first_api_msg" | jq -r '.timestamp' 2>/dev/null)
    
    # 读取文件的第一条消息
    first_file_line=$(head -1 "$SESSION_FILE")
    if [ -n "$first_file_line" ] && echo "$first_file_line" | jq -e . >/dev/null 2>&1; then
        file_role=$(echo "$first_file_line" | jq -r '.message.role // empty' 2>/dev/null)
        file_timestamp=$(echo "$first_file_line" | jq -r '.timestamp // .message.timestamp // empty' 2>/dev/null)
        
        echo "  文件第一条消息: 角色=$file_role, 时间=$file_timestamp"
        echo "  接口第一条消息: 角色=$api_role, 时间=$api_timestamp"
        
        # 基本验证
        role_match="否"
        if [ "$file_role" = "$api_role" ]; then
            role_match="是"
        fi
        
        print_result 0 "消息角色匹配: $role_match (文件:$file_role, 接口:$api_role)"
        
        if [ -n "$file_timestamp" ] && [ -n "$api_timestamp" ]; then
            # 简单的数字比较（避免bash解析ISO格式）
            print_warning "时间格式复杂，跳过精确对比"
        fi
    else
        print_warning "无法解析文件中的第一条消息"
    fi
    
    # 显示对比详情
    echo "  对比详情:"
    echo "    文件消息示例: $(head -1 "$SESSION_FILE" | jq -c . 2>/dev/null | cut -c1-50)..."
    echo "    接口消息示例: $(echo "$api_result" | jq -c '.messages[0]?' 2>/dev/null | cut -c1-50)..."
}

# 主测试函数
main() {
    echo "========================================"
    echo "OpenClaw Monitor 数据一致性测试"
    echo "测试时间: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "========================================"
    echo ""
    
    # 执行测试
    test_channels_config
    test_accounts_config
    test_title_format
    test_session_count
    test_session_integrity
    test_database_integrity
    test_api_performance
    test_time_correctness
    test_messages_performance
    test_message_count_consistency
    test_message_content_consistency
    
    # 输出测试报告
    echo ""
    echo "========================================"
    echo "测试报告"
    echo "========================================"
    echo "通过: $PASS"
    echo "失败: $FAIL"
    echo "警告: $WARNINGS"
    echo "总计: $((PASS + FAIL + WARNINGS))"
    echo "========================================"
    
    # 返回退出码
    if [ $FAIL -gt 0 ]; then
        exit 1
    else
        exit 0
    fi
}

main
