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
    test_session_count
    test_session_integrity
    test_database_integrity
    test_api_performance
    
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
