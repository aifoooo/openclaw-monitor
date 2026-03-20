# OpenClaw Monitor 数据一致性测试计划

## 1. 测试概述

### 1.1 测试目标
验证 OpenClaw Monitor 系统的数据一致性和同步准确性，确保：
- 渠道配置正确同步
- Session 文件与数据库数据一致
- 实时同步机制正常工作

### 1.2 测试范围
- 渠道配置同步
- Session 文件同步
- 数据库数据一致性
- API 接口数据正确性

### 1.3 测试环境
- **服务器**: 43.128.29.188
- **后端端口**: 3000
- **前端端口**: 5173
- **数据库**: /var/lib/openclaw-monitor/monitor.db
- **Session文件**: /root/.openclaw/agents/*/sessions/*.jsonl
- **Token**: 7f7cc8be30d13703dc35e518ccba3c8ff30c2525cefaa05208a9a328f16483ed

---

## 2. 测试用例

### 2.1 渠道配置一致性测试

#### TC-01: 渠道配置验证
**测试目的**: 验证渠道配置是否正确同步到数据库

**前置条件**:
- OpenClaw Gateway 正常运行
- OpenClaw Monitor 后端正常运行

**测试步骤**:
1. 查询 OpenClaw 配置文件中的渠道信息
   ```bash
   cat /root/.openclaw/config.json | jq '.agents[].channels'
   ```

2. 查询数据库中的渠道信息
   ```bash
   sqlite3 /var/lib/openclaw-monitor/monitor.db "SELECT * FROM channels;"
   ```

3. 查询 API 返回的渠道信息
   ```bash
   curl -s -H "X-API-Key: TOKEN" http://localhost:3000/api/channels | jq '.'
   ```

**预期结果**:
- 三处数据完全一致
- 渠道数量正确（当前为2：qqbot, feishu）
- 每个渠道的账号信息正确

**当前数据**:
- qqbot: 2个账号（mime, wife）
- feishu: 无账号

---

#### TC-02: 账号配置验证
**测试目的**: 验证账号配置是否正确

**测试步骤**:
1. 查询 API 返回的账号列表
   ```bash
   curl -s -H "X-API-Key: TOKEN" http://localhost:3000/api/accounts | jq '.'
   ```

2. 验证账号与渠道的关联关系
   - mime 账号 → qqbot 渠道
   - wife 账号 → qqbot 渠道
   - feishu 默认账号 → feishu 渠道

**预期结果**:
- API 返回的账号数量与配置一致
- 账号的渠道ID正确
- 账号名称正确

---

### 2.2 Session 文件数量一致性测试

#### TC-03: Session 文件数量验证
**测试目的**: 验证各个 agent 的 session 文件数量与数据库记录一致

**测试步骤**:
1. 统计文件系统中的 session 文件数量
   ```bash
   for agent in /root/.openclaw/agents/*/sessions; do
     count=$(find "$agent" -name "*.jsonl" -type f | wc -l)
     echo "$(basename $(dirname $agent)): $count"
   done
   ```

2. 统计数据库中的 session 数量
   ```bash
   sqlite3 /var/lib/openclaw-monitor/monitor.db "
   SELECT 
     substr(session_key, 1, instr(session_key, ':')-1) as agent,
     COUNT(DISTINCT session_id) as session_count
   FROM runs 
   GROUP BY agent;
   "
   ```

3. 对比 API 返回的 chats 数量
   ```bash
   curl -s -H "X-API-Key: TOKEN" http://localhost:3000/api/chats | jq '.total'
   ```

**预期结果**:
- 文件系统 session 数量 = 数据库 session 数量 = API chats 数量
- 每个 agent 的 session 数量正确

**当前数据**:
- 文件系统: 7个 session（main:4, mime-feishu:1, mime-qq:1, wife-qq:1）
- API返回: 2个 chats
- **问题**: 数据不一致，需要排查

---

#### TC-04: Session 文件完整性验证
**测试目的**: 验证所有 session 文件都被正确解析

**测试步骤**:
1. 列出所有 session 文件
   ```bash
   find /root/.openclaw/agents/*/sessions -name "*.jsonl" -type f
   ```

2. 检查每个 session 文件是否在数据库中有记录
   ```bash
   for file in /root/.openclaw/agents/*/sessions/*.jsonl; do
     session_id=$(basename "$file" .jsonl)
     count=$(sqlite3 /var/lib/openclaw-monitor/monitor.db \
       "SELECT COUNT(*) FROM runs WHERE session_id='$session_id';")
     echo "$session_id: $count records"
   done
   ```

3. 验证 API 能否查询到每个 session
   ```bash
   curl -s -H "X-API-Key: TOKEN" \
     "http://localhost:3000/api/chats" | jq '.chats[].chatId'
   ```

**预期结果**:
- 每个 session 文件都在数据库中有记录
- 每个 session 都能通过 API 查询到

---

### 2.3 Session 内容同步测试

#### TC-05: Session 内容实时同步验证
**测试目的**: 验证 session 文件内容能实时同步到数据库

**测试步骤**:
1. 选择一个活跃的 session 文件（如 mime-qq）
2. 记录当前文件大小和数据库中的消息数量
   ```bash
   ls -l /root/.openclaw/agents/mime-qq/sessions/*.jsonl
   sqlite3 /var/lib/openclaw-monitor/monitor.db \
     "SELECT COUNT(*) FROM runs WHERE session_id='SESSION_ID';"
   ```

3. 发送一条新消息（通过 QQ 发送消息给机器人）

4. 等待 5-10 秒后检查：
   - 文件大小是否增加
   - 数据库记录是否增加
   - API 返回的消息是否包含新消息

5. 检查 `file_positions` 表的更新
   ```bash
   sqlite3 /var/lib/openclaw-monitor/monitor.db \
     "SELECT * FROM file_positions;"
   ```

**预期结果**:
- 新消息实时同步到数据库
- 文件位置指针正确更新
- API 能查询到新消息

---

#### TC-06: Session 文件增量读取验证
**测试目的**: 验证增量读取机制正确工作

**测试步骤**:
1. 查看当前文件读取位置
   ```bash
   sqlite3 /var/lib/openclaw-monitor/monitor.db \
     "SELECT file_path, position FROM file_positions;"
   ```

2. 查看文件实际大小
   ```bash
   ls -l /root/.openclaw/logs/cache-trace.jsonl
   ```

3. 验证 position 不大于文件大小

4. 发送新消息后，验证 position 正确更新

**预期结果**:
- position 指向文件末尾或接近末尾
- 新消息能被正确读取
- 不会重复读取已处理的消息

---

### 2.4 数据库数据完整性测试

#### TC-07: 数据库表完整性验证
**测试目的**: 验证数据库各表数据完整

**测试步骤**:
1. 检查各表记录数量
   ```bash
   sqlite3 /var/lib/openclaw-monitor/monitor.db "
   SELECT 'channels' as table_name, COUNT(*) as count FROM channels
   UNION ALL
   SELECT 'runs', COUNT(*) FROM runs
   UNION ALL
   SELECT 'cache_traces', COUNT(*) FROM cache_traces
   UNION ALL
   SELECT 'file_positions', COUNT(*) FROM file_positions;
   "
   ```

2. 检查数据完整性约束
   ```bash
   sqlite3 /var/lib/openclaw-monitor/monitor.db "PRAGMA integrity_check;"
   ```

3. 检查索引是否正常
   ```bash
   sqlite3 /var/lib/openclaw-monitor/monitor.db ".indices"
   ```

**预期结果**:
- 所有表都有数据
- 数据库完整性检查通过
- 索引正常工作

---

#### TC-08: Runs 表数据验证
**测试目的**: 验证 runs 表数据正确性

**测试步骤**:
1. 检查 runs 表的最新记录
   ```bash
   sqlite3 /var/lib/openclaw-monitor/monitor.db "
   SELECT run_id, session_id, session_key, status, message_count, created_at 
   FROM runs 
   ORDER BY created_at DESC 
   LIMIT 10;
   "
   ```

2. 验证 session_key 格式正确
   - 格式应为: `agent:accountId:channel:chatType:sessionId`

3. 验证 message_count 与实际消息数量一致

**预期结果**:
- runs 表有完整的运行记录
- session_key 格式正确
- message_count 准确

---

### 2.5 API 接口数据一致性测试

#### TC-09: Chats API 数据验证
**测试目的**: 验证 /api/chats 接口返回数据正确

**测试步骤**:
1. 获取 chats 列表
   ```bash
   curl -s -H "X-API-Key: TOKEN" \
     "http://localhost:3000/api/chats" | jq '.'
   ```

2. 验证返回的 chat 数量与数据库一致

3. 验证每个 chat 的字段完整：
   - chatId
   - sessionKey
   - title
   - messageCount
   - lastActivity

4. 验证分页功能正常

**预期结果**:
- API 返回的 chats 数量正确
- 每个字段都有正确的值
- 分页功能正常

---

#### TC-10: Messages API 数据验证
**测试目的**: 验证 /api/chats/{chatId}/messages 接口返回数据正确

**测试步骤**:
1. 获取某个 chat 的消息列表
   ```bash
   curl -s -H "X-API-Key: TOKEN" \
     "http://localhost:3000/api/chats/CHAT_ID/messages?limit=20&offset=0" | jq '.'
   ```

2. 验证消息数量与文件中的实际消息数量一致

3. 验证消息内容完整：
   - id
   - role
   - content
   - timestamp

4. 验证消息顺序正确（按时间排序）

5. 验证分页功能正常

**预期结果**:
- 消息数量正确
- 消息内容完整
- 消息顺序正确
- 分页功能正常

---

### 2.6 WebSocket 实时更新测试

#### TC-11: WebSocket 消息推送验证
**测试目的**: 验证 WebSocket 能实时推送新消息

**测试步骤**:
1. 建立 WebSocket 连接
   ```javascript
   const ws = new WebSocket('ws://43.128.29.188:3000/ws?token=TOKEN');
   ws.onmessage = (event) => {
     console.log('Received:', event.data);
   };
   ```

2. 发送一条新消息

3. 验证 WebSocket 收到 `new_message` 事件

4. 验证收到的事件数据完整

**预期结果**:
- WebSocket 连接成功
- 新消息触发 `new_message` 事件
- 事件数据完整

---

### 2.7 性能测试

#### TC-12: 大数据量查询性能测试
**测试目的**: 验证系统在大数据量下的性能

**测试步骤**:
1. 测试获取大量消息的性能
   ```bash
   time curl -s -H "X-API-Key: TOKEN" \
     "http://localhost:3000/api/chats/CHAT_ID/messages?limit=100&offset=0" > /dev/null
   ```

2. 测试数据库查询性能
   ```bash
   time sqlite3 /var/lib/openclaw-monitor/monitor.db \
     "SELECT COUNT(*) FROM runs;" > /dev/null
   ```

3. 测试文件解析性能
   ```bash
   time wc -l /root/.openclaw/agents/mime-qq/sessions/*.jsonl
   ```

**预期结果**:
- API 响应时间 < 1秒
- 数据库查询时间 < 100ms
- 文件解析效率可接受

---

## 3. 测试执行

### 3.1 测试执行顺序
1. TC-01 ~ TC-02: 渠道配置测试
2. TC-03 ~ TC-04: Session 数量测试
3. TC-05 ~ TC-06: 内容同步测试
4. TC-07 ~ TC-08: 数据库完整性测试
5. TC-09 ~ TC-10: API 接口测试
6. TC-11: WebSocket 测试
7. TC-12: 性能测试

### 3.2 测试执行方式
```bash
# 一键执行所有测试
bash /tmp/run-all-tests.sh
```

### 3.3 测试报告
测试完成后生成测试报告：`/tmp/test-report.md`

---

## 4. 缺陷追踪

### 4.1 已发现问题
| 编号 | 问题描述 | 严重程度 | 状态 |
|------|----------|----------|------|
| BUG-001 | Session文件数量不一致（7个文件 vs 2个chats） | 高 | 待修复 |
| BUG-002 | wife-qq的session未显示 | 中 | 待修复 |
| BUG-003 | main的4个session未显示 | 中 | 待修复 |

### 4.2 缺陷处理流程
1. 发现缺陷 → 记录到缺陷表
2. 分析原因 → 定位代码位置
3. 修复缺陷 → 提交代码
4. 回归测试 → 验证修复效果

---

## 5. 附录

### 5.1 测试命令汇总
```bash
# 渠道配置
cat /root/.openclaw/config.json | jq '.agents[].channels'
sqlite3 /var/lib/openclaw-monitor/monitor.db "SELECT * FROM channels;"
curl -s -H "X-API-Key: TOKEN" http://localhost:3000/api/channels | jq '.'

# 账号信息
curl -s -H "X-API-Key: TOKEN" http://localhost:3000/api/accounts | jq '.'

# Session 数量
find /root/.openclaw/agents/*/sessions -name "*.jsonl" | wc -l
curl -s -H "X-API-Key: TOKEN" http://localhost:3000/api/chats | jq '.total'

# 数据库完整性
sqlite3 /var/lib/openclaw-monitor/monitor.db "PRAGMA integrity_check;"

# 文件位置
sqlite3 /var/lib/openclaw-monitor/monitor.db "SELECT * FROM file_positions;"

# 最新记录
sqlite3 /var/lib/openclaw-monitor/monitor.db \
  "SELECT * FROM runs ORDER BY created_at DESC LIMIT 10;"
```

### 5.2 相关文件路径
- OpenClaw 配置: `/root/.openclaw/config.json`
- Session 文件: `/root/.openclaw/agents/*/sessions/*.jsonl`
- 监控数据库: `/var/lib/openclaw-monitor/monitor.db`
- 缓存跟踪: `/root/.openclaw/logs/cache-trace.jsonl`
- 后端代码: `/root/ws-mime-qq/openclaw-monitor/packages/backend/`
- 前端代码: `/root/ws-mime-qq/openclaw-monitor/packages/client/`

---

### TC-07: 时间数据正确性测试
**测试目的**: 验证 chats 表中的时间数据正确

**测试步骤**:
1. 获取当前时间戳
2. 检查数据库中的 `last_message_at` 是否超过当前时间
3. 检查标题中的时间格式是否正确

**预期结果**:
- 所有时间数据都在合理范围内（不超过当前时间）
- 标题格式为 `MM-DD HH:MM (sessionId)`

**相关缺陷**:
- BUG-004: 时间显示全部为同一时间（已修复）

---

## 修复记录

### BUG-004: 时间显示全部为同一时间
**问题描述**: 所有 chats 的 last_message_at 显示相同的时间

**原因**:
- 手动插入数据时使用了错误的时间戳
- sessions.json 中的 updatedAt 时间没有正确读取

**修复方案**:
- 清空 chats 表并重新同步
- 从 sessions.json 中读取正确的 updatedAt 时间

**验证**:
- TC-07 测试通过
- 时间数据正确显示

---

*测试计划更新时间: 2026-03-20 21:04*
