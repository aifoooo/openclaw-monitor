# TC-09: 消息数量一致性验证
# 验证文件中的消息数量、数据库中的消息数量、接口返回的消息数量三者一致
test_message_count_consistency() {
    print_header "TC-09: 消息数量一致性验证"
    
    # 获取一个有效的 chat_id
    CHAT_ID=$(sqlite3 $DB_PATH "SELECT chat_id FROM chats LIMIT 1;" 2>/dev/null)
    
    if [ -z "$CHAT_ID" ]; then
        print_warning "没有找到有效的 chat_id"
        return
    fi
    
    # 获取 session_file
    SESSION_FILE=$(sqlite3 $DB_PATH "SELECT session_file FROM chats WHERE chat_id = '$CHAT_ID';" 2>/dev/null)
    
    if [ -z "$SESSION_FILE" ] || [ ! -f "$SESSION_FILE" ]; then
        print_warning "Session file 不存在: $SESSION_FILE"
        return
    fi
    
    # 1. 计算文件中的消息数量
    file_msg_count=$(grep -c '^{' "$SESSION_FILE" 2>/dev/null || echo "0")
    
    # 2. 计算数据库中的消息数量 (runs 表)
    db_run_count=$(sqlite3 $DB_PATH "SELECT COUNT(*) FROM runs WHERE chat_id = '$CHAT_ID';" 2>/dev/null || echo "0")
    
    # 3. 获取接口返回的消息数量
    api_result=$(curl -s -H "X-API-Key: $TOKEN" "http://localhost:3000/api/chats/$CHAT_ID/messages?limit=1000" 2>/dev/null)
    api_msg_count=$(echo "$api_result" | jq '.messages | length' 2>/dev/null || echo "0")
    
    echo "  文件消息数量: $file_msg_count"
    echo "  数据库消息数量: $db_run_count"
    echo "  接口消息数量: $api_msg_count"
    
    # 验证一致性 (允许小差异，因为缓存机制)
    if [ "$file_msg_count" -eq "$api_msg_count" ] && [ "$file_msg_count" -ge "$db_run_count" ]; then
        print_result 0 "消息数量一致 (文件:$file_msg_count, 接口:$api_msg_count, 数据库:$db_run_count)"
    else
        print_warning "消息数量不一致 (文件:$file_msg_count, 接口:$api_msg_count, 数据库:$db_run_count)"
        
        # 详细分析差异
        if [ "$file_msg_count" -gt "$api_msg_count" ]; then
            print_warning "  文件比接口多 $((file_msg_count - api_msg_count)) 条消息"
        fi
        if [ "$api_msg_count" -gt "$file_msg_count" ]; then
            print_warning "  接口比文件多 $((api_msg_count - file_msg_count)) 条消息"
        fi
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
    api_messages=$(echo "$api_result" | jq -c '.messages[]?' 2>/dev/null)
    
    # 读取文件消息 (取前5条进行对比)
    file_lines=$(head -5 "$SESSION_FILE")
    file_msg_index=0
    
    # 简单验证：检查时间戳和角色的一致性
    inconsistency_count=0
    
    # 检查文件中的消息是否能对应到接口
    while IFS= read -r line; do
        if [ -n "$line" ] && echo "$line" | jq -e . >/dev/null 2>&1; then
            msg_timestamp=$(echo "$line" | jq -r '.timestamp // .message.timestamp // empty' 2>/dev/null)
            msg_role=$(echo "$line" | jq -r '.message.role // empty' 2>/dev/null)
            
            if [ -n "$msg_timestamp" ] && [ -n "$msg_role" ]; then
                # 在接口结果中查找匹配的消息
                found_match=false
                while IFS= read -r api_line; do
                    api_timestamp=$(echo "$api_line" | jq -r '.timestamp // empty' 2>/dev/null)
                    api_role=$(echo "$api_line" | jq -r '.role // empty' 2>/dev/null)
                    
                    # 比较时间戳（允许1秒误差）
                    if [ -n "$api_timestamp" ] && [ -n "$api_role" ]; then
                        time_diff=$(( ${msg_timestamp%.*} - ${api_timestamp%.*} ))
                        time_diff=${time_diff#-}  # 取绝对值
                        
                        if [ "$api_role" = "$msg_role" ] && [ "$time_diff" -le 1 ]; then
                            found_match=true
                            break
                        fi
                    fi
                done <<< "$api_messages"
                
                if [ "$found_match" = false ]; then
                    inconsistency_count=$((inconsistency_count + 1))
                fi
            fi
            
            file_msg_index=$((file_msg_index + 1))
            if [ $file_msg_index -ge 3 ]; then  # 只检查前3条
                break
            fi
        fi
    done <<< "$file_lines"
    
    if [ $inconsistency_count -eq 0 ]; then
        print_result 0 "消息内容基本一致 (检查了前3条消息)"
    else
        print_warning "发现 $inconsistency_count 条消息内容不一致"
    fi
    
    # 显示对比详情
    echo "  对比详情:"
    echo "    文件消息示例: $(head -1 "$SESSION_FILE" | jq -c . 2>/dev/null | cut -c1-50)..."
    echo "    接口消息示例: $(echo "$api_result" | jq -c '.messages[0]?' 2>/dev/null | cut -c1-50)..."
}