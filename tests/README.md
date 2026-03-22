# OpenClaw Monitor 测试指南

## 快速开始

### 执行 UI 自动化测试

```bash
# 直接执行（使用默认 API Key）
./ui-test.sh

# 指定 API Key
./ui-test.sh "your-api-key"

# 指定环境变量
FRONTEND_URL=http://localhost:5173 API_URL=http://localhost:3000 ./ui-test.sh
```

### 测试输出

- 控制台输出：实时显示测试进度
- 报告文件：`UI-TEST-REPORT.md`

## AI 快速使用指南

### 对于后续 AI 会话

**直接调用测试脚本：**

```
执行 UI 测试：
cd ~/ws-mime-qq/openclaw-monitor/tests && ./ui-test.sh
```

**测试覆盖内容：**

1. 登录验证
2. 账号筛选
3. 会话列表
4. 消息详情
5. WebSocket 连接
6. 数据一致性（文件=API=数据库）

### 常见问题排查

**测试失败时检查：**

1. 服务是否运行
   ```bash
   systemctl status openclaw-monitor
   curl http://localhost:3000/health
   ```

2. 数据库是否存在
   ```bash
   ls -la /var/lib/openclaw-monitor/monitor.db
   ```

3. 会话文件是否存在
   ```bash
   ls ~/.openclaw/agents/*/sessions/*.jsonl
   ```

## 测试文件说明

| 文件 | 说明 |
|------|------|
| `ui-test.sh` | UI 自动化测试脚本（可直接执行） |
| `UI-TEST-PLAN.md` | 测试计划文档 |
| `UI-TEST-REPORT.md` | 测试报告（测试后生成） |
| `run-tests.sh` | 后端单元测试 |

## 依赖

- `agent-browser`: `npm install -g agent-browser`
- `jq`: `yum install jq -y`
- `sqlite3`: `yum install sqlite -y`

## 修复记录

### 2026-03-22

修复的问题：
1. ✅ 消息分页逻辑错误（offset 参数被忽略）
2. ✅ messageCount 不准确（包含 toolResult）
3. ✅ 历史备份文件被误删（cleanOrphanedChats）
4. ✅ message_count 不实时更新（新增 incrementChatMessageCount）

验证结果：
- 12 个会话全部通过三方一致性验证
- 4991 条消息的大数据量会话正常加载
