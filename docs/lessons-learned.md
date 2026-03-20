# OpenClaw Monitor 项目经验总结

> 本文档记录项目从建立到稳定运行的关键活动、经验教训和最佳实践，供后续项目参考。

---

## 一、项目概述

**项目名称**：OpenClaw Monitor  
**项目目标**：实时监控 OpenClaw 运行状态，包括渠道、聊天、消息、LLM 调用等  
**技术栈**：Vue 3 + Hono + SQLite + WebSocket  
**开发周期**：约 2 周  
**提交数量**：90 个

---

## 二、项目演进历程

### 阶段一：初始开发（提交 1-14）

**时间**：项目启动 ~ 基础功能完成  
**主要工作**：
- 架构设计和文档编写
- 代理系统实现
- 后端 REST API 和 WebSocket
- 前端 Vue 3 组件开发

**关键决策**：
- 选择 SQLite 作为数据库（轻量、无运维）
- 使用 Hono 框架（现代、高性能）
- Vue 3 + TypeScript 前端架构

### 阶段二：优化加固（提交 15-29）

**时间**：基础功能完成后  
**主要工作**：
- 添加一键安装脚本
- 实现健康检查机制
- 安全配置（CORS、日志安全）
- 性能优化

**关键改进**：
- 日志轮转避免磁盘爆满
- 错误重试机制提升稳定性
- 健康检查确保服务可用性

### 阶段三：架构重构（提交 30-41）

**时间**：发现性能瓶颈后  
**主要工作**：
- 重构为基于 Cache Trace 的监控方案
- 实现多路由代理系统
- 文档结构重组

**重大决策**：
- **不再存储原始数据**，只保留聚合后的 runs 表
- 效果：数据库大小减少 90%+，查询性能大幅提升

### 阶段四：前端重构（提交 42-52）

**时间**：功能稳定后  
**主要工作**：
- 重构前端界面布局
- UI 样式优化
- 添加聊天隐藏功能
- Markdown 渲染支持

### 阶段五：实时推送与稳定性（提交 53-90）

**时间**：部署运行后持续优化  
**主要工作**：
- WebSocket 实时推送
- 消息排序和时间同步
- 性能优化（tail 命令读取大文件）
- 数据一致性修复
- systemd 服务部署

---

## 三、关键问题与解决方案

### 3.1 数据库膨胀问题

**问题**：
- 原始设计存储每条 cache_trace 记录
- 文件每天增长 4.25GB，数据库迅速膨胀

**解决方案**：
1. 配置优化：关闭 `includePrompt` 和 `includeSystem`
2. 架构重构：只存储聚合后的 runs 表，不存储原始 cache_traces
3. 自动清理：cron 任务定期清理过期数据

**效果**：
- 文件增长从 4.25GB/天 → 0.7GB/天（减少 83%）
- 数据库大小减少 90%+

**经验教训**：
> **不要存储原始数据**。对于监控类系统，应该存储聚合后的结果而非原始日志。原始数据应该用文件轮转策略管理，而不是存入数据库。

---

### 3.2 大文件读取性能问题

**问题**：
- session 文件达到 28MB，包含 8000+ 条消息
- 读取整个文件再分页导致超时（>30s）

**解决方案**：
- 使用 `tail -n` 命令只读取文件末尾的 N 行
- 避免将整个文件加载到内存

```typescript
// 优化前
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');

// 优化后
const output = execSync(`tail -n ${limit} "${filePath}"`, { encoding: 'utf-8' });
const lines = output.trim().split('\n');
```

**效果**：
- 响应时间从 >30s（超时）→ 200-300ms

**经验教训**：
> **使用系统命令处理大文件**。对于日志类大文件，`tail`、`head`、`grep` 等命令比纯 Node.js 实现更高效。

---

### 3.3 服务稳定性问题

**问题**：
- 前端进程经常"挂掉"
- 系统内存紧张（2GB 内存，使用 2.3GB swap）
- 多次触发 OOM Killer

**解决方案**：
1. 创建 systemd 服务替代 nohup 运行
2. 配置 `Restart=always` 自动重启
3. 限制内存 `--max-old-space-size=512`

```ini
[Unit]
Description=OpenClaw Monitor Frontend
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node --max-old-space-size=512 /path/to/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**经验教训**：
> **生产环境必须使用进程管理器**。nohup 只是后台运行，崩溃后不会重启。systemd、pm2 等工具能确保服务持续运行。

---

### 3.4 systemd 服务部署问题

**问题**：
- ESM 模块导入要求 `.js` 后缀
- better-sqlite3 版本不匹配
- 全局命令路径问题

**解决方案**：
1. 使用 tsx 直接运行 TypeScript 源码，避免 ESM 后缀问题
2. 重新编译 better-sqlite3：`npm rebuild better-sqlite3`
3. 使用项目本地依赖路径：`node_modules/.bin/tsx`

**经验教训**：
> **Native 模块需要针对运行环境编译**。部署时应该重新 `npm rebuild` 确保所有 native 模块与当前 Node.js 版本匹配。

---

### 3.5 数据一致性问题

**问题**：
- 文件、接口、数据库三者消息数量不一致
- 测试活跃会话时数据不断变化

**原因分析**：
1. `runs` 表存储 LLM 调用记录，不是聊天消息
2. 接口返回了 `toolResult` 类型消息（不应作为独立消息）
3. 测试时数据实时增长导致时间范围不同

**解决方案**：
1. 排除 `toolResult` 类型消息
2. 统一时间范围验证：以数据库时间戳为基准
3. 测试不活跃的会话（超过 1 小时无活动）

**经验教训**：
> **理解数据模型是关键**。不同表的用途不同，不能想当然地假设。测试时要注意数据的实时性，统一时间范围才能准确验证一致性。

---

### 3.6 账号重复问题

**问题**：
- 账号列表显示重复
- mime-qq、wife-qq、main 都被当作渠道

**原因**：
- `scanAllSessions` 从 agent 目录名推断渠道 ID
- 应该从 sessionKey 提取正确的渠道信息

**解决方案**：
- 重写 `scanAllSessions`，从 `sessions.json` 读取正确的 sessionKey 映射

**经验教训**：
> **不要推断，要读取配置**。从文件名或目录名推断信息容易出错，应该读取实际的配置文件获取准确信息。

---

### 3.7 时间同步问题

**问题**：
- 聊天列表时间和消息时间不一致
- sessions.json 中的 `updatedAt` 滞后于消息文件

**解决方案**：
1. 定时同步任务（每分钟从消息文件读取最新时间）
2. WebSocket 消息使用消息实际时间戳

**经验教训**：
> **元数据可能滞后**。不要完全依赖元数据文件的时间戳，应该从实际数据源获取准确信息。

---

## 四、最佳实践

### 4.1 架构设计

| 实践 | 说明 |
|------|------|
| 聚合存储 | 不存储原始数据，只存储聚合结果 |
| 增量解析 | 文件监听 + 增量解析，避免重复处理 |
| 容错设计 | 解析失败跳过、WebSocket 重连、SQLite 写入重试 |

### 4.2 性能优化

| 实践 | 说明 |
|------|------|
| 系统命令 | 使用 `tail`、`grep` 等命令处理大文件 |
| 索引优化 | 为 run_id、session_id、started_at 创建索引 |
| 批量操作 | 使用事务批量写入，减少 IO |

### 4.3 运维部署

| 实践 | 说明 |
|------|------|
| systemd 服务 | 自动重启、日志管理、开机自启 |
| 健康检查 | `/health` 端点 + 定时检查脚本 |
| 日志轮转 | 避免磁盘爆满 |
| 数据清理 | 定期清理过期数据 + VACUUM |

### 4.4 测试策略

| 实践 | 说明 |
|------|------|
| 一致性测试 | 验证文件、接口、数据库三者数据一致 |
| 性能测试 | 测量 API 响应时间 |
| 时间数据测试 | 验证时间戳的合理性和一致性 |

---

## 五、技术决策记录

### 决策 1：SQLite vs PostgreSQL

**选择**：SQLite  
**理由**：
- 轻量级，无需独立进程
- 单文件，易于备份和迁移
- 对于监控数据量足够

### 决策 2：Hono vs Express

**选择**：Hono  
**理由**：
- 现代、类型安全
- 更小的包体积
- 更好的 TypeScript 支持

### 决策 3：存储原始数据 vs 聚合数据

**选择**：聚合数据  
**理由**：
- 原始数据膨胀太快
- 查询性能下降明显
- 聚合数据满足业务需求

---

## 六、工具和脚本

### 安装脚本

```bash
# 一键安装
./scripts/install.sh

# 自定义路径
./scripts/install.sh --db-path /data/monitor.db
```

### 健康检查

```bash
# 手动检查
./scripts/healthcheck.sh

# 系统服务自动检查
systemctl status openclaw-monitor
```

### 数据清理

```bash
# 日志清理（每天自动执行）
/etc/cron.daily/openclaw-cache-trace-cleanup

# 数据库清理（每天自动执行）
/etc/cron.daily/openclaw-monitor-db-cleanup
```

---

## 七、文档结构

```
openclaw-monitor/
├── README.md              # 项目介绍和快速开始
├── DEVELOPMENT.md         # 开发指南
├── docs/
│   ├── architecture.md    # 架构设计
│   ├── security.md        # 安全设计
│   ├── test-report-final.md  # 测试报告
│   └── lessons-learned.md # 本文档
├── tests/
│   ├── run-tests.sh       # 测试脚本
│   └── additional-tests.sh # 补充测试
└── scripts/
    ├── install.sh         # 安装脚本
    ├── uninstall.sh       # 卸载脚本
    └── healthcheck.sh     # 健康检查
```

---

## 八、后续改进建议

### 短期
- [ ] 添加 Prometheus metrics 导出
- [ ] 支持多租户隔离
- [ ] 前端国际化

### 中期
- [ ] 支持自定义告警规则
- [ ] 添加数据导出功能
- [ ] 支持集群部署

### 长期
- [ ] 支持其他 LLM 框架（不只是 OpenClaw）
- [ ] 添加 AI 辅助分析功能

---

## 九、致谢

本项目在开发过程中经历了多次迭代和优化，感谢所有参与者的贡献。

---

*文档版本：1.0*  
*最后更新：2026-03-21*
