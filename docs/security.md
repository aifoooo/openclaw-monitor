# 安全配置指南

本文档说明如何安全地使用 OpenClaw Monitor。

## 安全风险

默认配置下，OpenClaw Monitor 存在以下安全风险：

| 风险 | 说明 |
|------|------|
| HTTP 明文传输 | 数据可被窃听 |
| 无认证机制 | 任何人都可以访问 API |
| CORS 全开放 | 任何网站都可以调用 API |

---

## 方案一：SSH 隧道（推荐）

**适用场景**：客户端和服务端在不同机器上，没有域名。

### 架构

```
┌─────────────────────────────────────┐
│  服务端 (同一台机器)                 │
│  ┌─────────────────────────────┐   │
│  │ openclaw-proxy (38080)      │   │
│  │ openclaw-backend (3000)     │   │
│  │ openclaw-gateway            │   │
│  └─────────────────────────────┘   │
│                                     │
│  Gateway → 代理：localhost:38080   │
│  （同一台机器，不需要加密）          │
└─────────────────────────────────────┘
         ↑
         │ SSH 隧道（加密）
         │
┌─────────────────────────────────────┐
│  客户端                              │
│  ┌─────────────────────────────┐   │
│  │ 前端 → localhost:3000       │   │
│  │ （通过 SSH 隧道转发）        │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

### 使用方法

**在客户端机器执行**：

```bash
# 基本用法
ssh -L 3000:localhost:3000 user@服务器IP

# 保持连接（推荐）
ssh -L 3000:localhost:3000 -o ServerAliveInterval=60 user@服务器IP

# 后台运行
ssh -fNL 3000:localhost:3000 user@服务器IP
```

**参数说明**：
- `-L 3000:localhost:3000`：将本地 3000 端口转发到服务端的 localhost:3000
- `-o ServerAliveInterval=60`：每 60 秒发送心跳，保持连接
- `-fN`：后台运行，不打开 shell

### 前端配置

SSH 隧道建立后，前端连接 localhost：

```bash
# .env
VITE_API_BASE=http://localhost:3000
```

### 优点

- ✅ 无需证书
- ✅ 加密传输
- ✅ 简单易用
- ✅ SSH 自带认证

### 缺点

- ⚠️ 需要保持 SSH 连接
- ⚠️ 每个用户都需要配置

---

## 方案二：自签名证书 + HTTPS

**适用场景**：没有域名，但需要直接访问。

### 生成自签名证书

```bash
# 在服务端执行
openssl req -x509 -newkey rsa:4096 \
  -keyout /etc/openclaw-monitor/key.pem \
  -out /etc/openclaw-monitor/cert.pem \
  -days 365 -nodes \
  -subj "/CN=<服务器IP>"
```

### 配置后端使用 HTTPS

编辑 `.env`：

```bash
HTTPS_ENABLED=true
HTTPS_KEY=/etc/openclaw-monitor/key.pem
HTTPS_CERT=/etc/openclaw-monitor/cert.pem
```

### 前端配置

```bash
# .env
VITE_API_BASE=https://服务器IP:3000
```

### 信任证书（客户端）

**浏览器**：
1. 访问 `https://服务器IP:3000/health`
2. 点击 "高级" → "继续访问"

**系统级信任**：
```bash
# Linux
sudo cp cert.pem /usr/local/share/ca-certificates/openclaw-monitor.crt
sudo update-ca-certificates

# macOS
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain cert.pem

# Windows
certutil -addstore "Root" cert.pem
```

### 优点

- ✅ 加密传输
- ✅ 不需要域名
- ✅ 直接访问

### 缺点

- ⚠️ 浏览器警告
- ⚠️ 需要手动信任证书

---

## 方案三：Token 认证（必须实现）

无论使用哪种传输方案，都应该启用 Token 认证。

### 配置

编辑 `.env`：

```bash
# 生成随机 Token
API_TOKEN=$(openssl rand -hex 32)
```

### 前端配置

```bash
# .env
VITE_API_TOKEN=your-token-here
```

### 使用

所有 API 请求需要携带 Token：

```bash
curl -H "Authorization: Bearer your-token-here" http://localhost:3000/api/channels
```

---

## 方案对比

| 方案 | 加密 | 认证 | 复杂度 | 适用场景 |
|------|------|------|--------|----------|
| SSH 隧道 | ✅ | ✅ | 低 | 个人使用 |
| 自签名证书 | ✅ | ❌ | 中 | 内网使用 |
| Token 认证 | ❌ | ✅ | 低 | 必须启用 |

---

## 推荐配置

**生产环境**：

```
SSH 隧道 + Token 认证
```

**内网环境**：

```
自签名证书 + Token 认证
```

---

## 检查清单

- [ ] 已配置 Token 认证
- [ ] 已配置 SSH 隧道或 HTTPS
- [ ] 已限制 CORS（生产环境）
- [ ] 已修改默认端口（可选）
