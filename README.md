# OpenClaw Monitor

实时监控 OpenClaw 运行状态，追踪每次请求的操作细节。

## 背景

OpenClaw 服务器通常部署在云端，而用户在本地使用。当需要监控运行状态时，直接访问云端 Web UI 会面临：

- **网络延迟高**：服务器在香港，用户在大陆，加载资源慢
- **数据同步慢**：每次刷新都要重新拉取全量数据
- **调试困难**：看不到 LLM 的原始输入输出

本项目通过**本地缓存 + 增量同步**解决这些问题，同时通过**HTTP 代理**捕获完整的 LLM 请求响应。

## 功能特性

### 核心功能

| 功能 | 说明 |
|------|------|
| 📋 渠道管理 | 查看已配置的渠道列表，切换当前渠道 |
| 💬 聊天列表 | 查看当前渠道下的所有聊天 |
| 📝 消息详情 | 查看用户发送的消息和助手回复 |
| 🔍 操作追踪 | 追踪每次请求触发的所有操作（命令执行、LLM 调用、API 调用） |
| 📊 性能分析 | 显示每个操作的耗时、Token 使用量 |
| 🔄 实时更新 | 文件变更自动推送，无需手动刷新 |

### 特色功能

- **LLM 输入输出捕获**：通过 HTTP 代理拦截，记录完整的 prompt 和响应
- **流式响应支持**：正确处理 LLM 的流式输出
- **离线查看**：本地缓存历史数据，断网也能查看
- **自动故障切换**：代理不可用时自动切换到直连

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│  OpenClaw Gateway                                          │
│  baseUrl: http://localhost:38080/v3                        │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  监控代理 (packages/proxy)                                  │
│  - 拦截 LLM 请求/响应                                       │
│  - 记录到本地日志                                           │
│  - 转发到真实 API                                           │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  后端服务 (packages/backend)                                │
│  - 解析 session 文件                                        │
│  - 合并代理日志                                             │
│  - 提供 REST API + WebSocket                                │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  前端客户端 (packages/client)                               │
│  - Vue 3 + TypeScript                                       │
│  - 实时数据展示                                             │
└─────────────────────────────────────────────────────────────┘
```

## 快速开始

### 一键安装

```bash
# 克隆项目
git clone https://github.com/aifoooo/openclaw-monitor.git
cd openclaw-monitor

# 运行安装脚本（使用默认配置）
sudo ./scripts/install.sh

# 或自定义安装路径
sudo ./scripts/install.sh --dir /opt/openclaw-monitor --log-dir /var/log/openclaw-monitor
```

### 配置文件

复制配置文件模板：

```bash
cp .env.example .env
```

编辑 `.env` 文件修改配置：

```bash
# 代理配置
PROXY_PORT=38080
TARGET_URL=https://api.lkeap.cloud.tencent.com/coding/v3
LOG_DIR=/var/log/openclaw-monitor
LOG_ROTATION_DAYS=7

# 后端配置
BACKEND_PORT=3000
OPENCLAW_DIR=/root/.openclaw
```

安装脚本会自动：
1. ✅ 检查依赖
2. ✅ 安装项目依赖
3. ✅ 构建项目
4. ✅ 安装 systemd 服务
5. ✅ 安装健康检查脚本
6. ✅ 配置 OpenClaw
7. ✅ 启动服务

### 卸载

```bash
sudo ./scripts/uninstall.sh
```

### 手动安装

<details>
<summary>点击展开手动安装步骤</summary>

#### 前置要求

- Node.js >= 18
- pnpm >= 8

#### 步骤

```bash
# 1. 安装依赖
pnpm install

# 2. 构建
pnpm build

# 3. 创建日志目录
mkdir -p /var/log/openclaw-monitor

# 4. 安装 systemd 服务
sudo cp scripts/openclaw-proxy.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable openclaw-proxy
sudo systemctl start openclaw-proxy

# 5. 安装健康检查脚本
sudo cp scripts/proxy-healthcheck.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/proxy-healthcheck.sh

# 6. 添加 cron 任务（每分钟检查）
(crontab -l 2>/dev/null | grep -v "proxy-healthcheck"; echo "* * * * * /usr/local/bin/proxy-healthcheck.sh") | crontab -

# 7. 修改 OpenClaw 配置
jq '.models.providers.tencentcodingplan.baseUrl = "http://localhost:38080/v3"' \
    /root/.openclaw/openclaw.json > /tmp/openclaw.json.tmp && \
    mv /tmp/openclaw.json.tmp /root/.openclaw/openclaw.json

# 8. 重启 OpenClaw Gateway
systemctl restart openclaw-gateway
```

</details>

## 推荐配置

### 1. 模型降级链

即使有代理，也建议配置降级链作为兜底：

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "tencentcodingplan/glm-5",
        "fallbacks": [
          "tencentcodingplan/hunyuan-2.0-thinking",
          "deepseek/deepseek-reasoner"
        ]
      }
    }
  }
}
```

**效果**：代理不可用时，自动降级到其他模型。

### 2. systemd 自动重启

代理服务已配置自动重启：

```ini
[Service]
Restart=always
RestartSec=3
```

**效果**：代理崩溃后 3 秒内自动恢复。

### 3. 健康检查脚本

每分钟检测代理状态，自动切换配置：

- 代理可用 → 使用代理（记录完整请求/响应）
- 代理不可用 → 切换到直连（保证服务可用）

**效果**：长时间故障时，一次性切换，避免每次请求都等待超时。

## 故障处理流程

### 服务启动顺序

```
1. openclaw-proxy    (代理服务，监听 38080)
2. openclaw-backend  (后端服务，监听 3000)
3. openclaw-gateway  (OpenClaw Gateway)
```

**依赖关系**：
- Gateway 依赖代理（baseUrl 指向代理）
- 后端独立运行，不依赖其他服务

**手动启动**：
```bash
# 按顺序启动
systemctl start openclaw-proxy
systemctl start openclaw-backend
systemctl start openclaw-gateway
```

**手动停止**：
```bash
# 按相反顺序停止
systemctl stop openclaw-gateway
systemctl stop openclaw-backend
systemctl stop openclaw-proxy
```

```
代理崩溃
    ↓
systemd 3秒内自动重启
    ↓
重启期间请求失败
    ↓
模型降级链自动降级到 DeepSeek
    ↓
代理恢复后自动切回
```

如果代理长时间无法恢复：

```
健康检查脚本检测到代理不可用
    ↓
自动修改配置，切换到直连
    ↓
重启 Gateway（一次性中断）
    ↓
之后所有请求都走直连，无额外延迟
```

## 项目结构

```
openclaw-monitor/
├── packages/
│   ├── proxy/            # HTTP 代理
│   │   └── src/
│   │       └── index.ts  # 代理服务
│   ├── backend/          # 后端服务
│   │   └── src/
│   │       ├── parser/   # session 文件解析
│   │       ├── routes/   # REST API
│   │       └── watcher/  # 文件监听
│   └── client/           # 前端客户端
│       └── src/
│           ├── components/  # Vue 组件
│           ├── router/      # 路由配置
│           └── services/    # API 服务
├── scripts/
│   ├── install.sh              # 一键安装脚本
│   ├── openclaw-proxy.service  # systemd 服务文件
│   └── proxy-healthcheck.sh    # 健康检查脚本
├── docs/
│   └── architecture.md   # 详细架构设计
├── package.json
└── pnpm-workspace.yaml
```

## API 文档

### REST API

| 端点 | 说明 |
|------|------|
| `GET /api/channels` | 获取渠道列表 |
| `GET /api/chats?channel=xxx` | 获取聊天列表 |
| `GET /api/messages?chat=xxx` | 获取消息列表 |
| `GET /api/operations?message=xxx` | 获取操作详情 |

### WebSocket

```
ws://localhost:3000/ws
```

事件：
- `session:update` - session 文件更新
- `llm:request` - LLM 请求拦截
- `llm:response` - LLM 响应拦截

## 常用命令

```bash
# 查看代理状态
systemctl status openclaw-proxy

# 查看代理日志
journalctl -u openclaw-proxy -f

# 重启代理
systemctl restart openclaw-proxy

# 查看健康检查日志
tail -f /var/log/openclaw-monitor/proxy-healthcheck.log

# 查看 LLM 请求日志
tail -f /var/log/openclaw-monitor/llm-$(date +%Y-%m-%d).jsonl
```

## 许可证

MIT
