# 安全设计

## 威胁模型

### 攻击面分析

| 攻击面 | 风险等级 | 说明 |
|--------|----------|------|
| 文件读取 | 高 | 解析 Cache Trace 文件 |
| SQL 注入 | 中 | SQLite 数据库操作 |
| WebSocket | 低 | 本地服务，仅限本机访问 |
| API 接口 | 低 | 本地服务，仅限本机访问 |

## 安全措施

### 1. 文件路径验证

**风险**：路径穿越攻击

**措施**：
```typescript
function validateFilePath(filePath: string): boolean {
  const absolutePath = path.resolve(filePath);
  
  // 只允许访问特定目录
  const allowedDirs = [
    config.openclawDir,
    path.join(process.env.HOME || '/root', '.openclaw/logs'),
    '/tmp',
  ];
  
  const isAllowed = allowedDirs.some(dir => 
    absolutePath.startsWith(path.resolve(dir))
  );
  
  if (!isAllowed) {
    console.error(`[Security] Path traversal attempt: ${filePath}`);
    return false;
  }
  
  // 禁止路径穿越
  if (filePath.includes('..') || filePath.includes('\0')) {
    console.error(`[Security] Invalid path pattern: ${filePath}`);
    return false;
  }
  
  return true;
}
```

### 2. SQL 注入防护

**风险**：恶意输入导致 SQL 注入

**措施**：
- 使用参数化查询
- 使用 ORM 或查询构建器
- 输入验证

```typescript
// 正确做法
const stmt = db.prepare('SELECT * FROM runs WHERE run_id = ?');
const run = stmt.get(runId);

// 错误做法（有 SQL 注入风险）
const run = db.exec(`SELECT * FROM runs WHERE run_id = '${runId}'`);
```

### 3. WebSocket 安全

**风险**：未授权访问

**措施**：
- 只监听 localhost
- 可选：Token 认证

```typescript
// 只监听本地
app.listen({ port: 3001, hostname: 'localhost' });

// 可选：Token 认证
app.use('*', async (c, next) => {
  const token = c.req.header('Authorization');
  if (token !== config.apiToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});
```

### 4. 输入验证

**风险**：恶意输入导致异常

**措施**：
- 验证所有外部输入
- 限制输入长度
- 类型检查

```typescript
import { z } from 'zod';

const RunQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sessionKey: z.string().optional(),
});

app.get('/api/runs', async (c) => {
  const query = RunQuerySchema.parse(c.req.query());
  // ...
});
```

### 5. 敏感数据处理

**风险**：敏感数据泄露

**措施**：
- Cache Trace 可能包含敏感信息
- 不记录 API Key
- 不记录完整的 system prompt（可选）

```typescript
// 脱敏处理
function sanitizeMessage(msg: CacheTraceMessage): CacheTraceMessage {
  // 移除敏感信息
  if (msg.content) {
    msg.content = msg.content.map(c => {
      if (c.type === 'text' && c.text?.includes('API Key')) {
        c.text = c.text.replace(/sk-[a-zA-Z0-9]+/g, 'sk-***');
      }
      return c;
    });
  }
  return msg;
}
```

### 6. 日志安全

**风险**：日志中泄露敏感信息

**措施**：
- 不记录完整的请求/响应内容
- 不记录 API Key
- 限制日志级别

```typescript
// 正确做法
console.log(`[Parser] Parsed ${entries.length} entries`);

// 错误做法
console.log(`[Parser] Entry: ${JSON.stringify(entry)}`);
```

## 安全检查清单

- [ ] 文件路径验证
- [ ] SQL 参数化查询
- [ ] WebSocket 仅监听 localhost
- [ ] 输入验证
- [ ] 敏感数据脱敏
- [ ] 日志安全
- [ ] 错误处理不泄露内部信息

## 审计日志

记录关键操作：

```typescript
interface AuditLog {
  timestamp: number;
  action: 'file_read' | 'db_write' | 'ws_push' | 'api_call';
  user?: string;
  resource: string;
  result: 'success' | 'failure';
  error?: string;
}
```

## 更新策略

- 定期检查依赖漏洞：`npm audit`
- 及时更新依赖版本
- 关注安全公告
