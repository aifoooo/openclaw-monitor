# OpenClaw Monitor

实时监控 OpenClaw 运行状态，追踪每次请求的操作细节。

## 背景

OpenClaw 在处理消息时，可能出现响应缓慢或无响应的情况，传统排查方式难以定位问题。

**痛点**：
- 任务执行状态不透明
- 无法定位性能瓶颈
- 难以追踪故障环节

本项目通过解析 **Cache Trace** 和 **Gateway 日志**，追踪每次请求的完整操作细节，提供可视化监控界面。

---

## 功能特性

| 功能 | 说明 |
|------|------|
| 渠道管理 | 查看已配置的渠道列表，切换当前渠道 |
| 聊天列表 | 查看当前渠道下的所有聊天 |
| 消息详情 | 查看用户发送的消息和助手回复 |
| 操作追踪 | 追踪每次请求触发的所有操作（LLM 调用、工具执行） |
| 性能分析 | 显示每个操作的耗时、Token 使用量 |
| 实时更新 | 文件变更自动推送，无需手动刷新 |

---

## 快速开始

### 前置条件

1. **OpenClaw 已配置 Cache Trace**

```json
{
  "diagnostics": {
    "enabled": true,
    "cacheTrace": {
      "enabled": true,
      "includeMessages": true,
      "includePrompt": true,
      "includeSystem": true
    }
  }
}
```

2. **OpenClaw 已配置 DEBUG 日志级别**

```json
{
  "logging": {
    "level": "debug"
  }
}
```

3. **Node.js 22+**

### 安装

```bash
git clone https://github.com/aifoooo/openclaw-monitor.git
cd openclaw-monitor
pnpm install
pnpm build
pnpm dev
```

### 配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `OPENCLAW_DIR` | `/root/.openclaw` | OpenClaw 配置目录 |
| `PORT` | `3000` | 后端 API 端口 |

---

## 文档

- [架构设计](docs/architecture.md) - 系统架构、数据模型、数据流
- [测试报告](docs/test-report-final.md) - 测试覆盖和结果

---

## 开发状态

### 已完成

- Cache Trace 解析（LLM 输入输出）
- Gateway 日志解析（工具执行追踪）
- 渠道管理功能
- 聊天列表功能
- 消息详情功能
- 操作追踪时间线
- WebSocket 实时推送
- 安全加固（认证、速率限制、CORS）
- 单元测试（11 个用例，100% 通过）

### 进行中

- 性能分析图表优化
- Token 使用量图表
- 成本统计图表

---

## License

MIT
