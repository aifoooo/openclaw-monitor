#!/bin/bash
# OpenClaw Monitor 快速启动脚本

set -e

echo "🦐 OpenClaw Monitor - 快速启动"
echo "================================"

# 检查 Node.js 版本
NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$NODE_VERSION" -lt 22 ]; then
  echo "❌ 错误: 需要 Node.js >= 22.0.0"
  echo "   当前版本: $(node -v)"
  exit 1
fi

echo "✅ Node.js 版本: $(node -v)"

# 安装依赖
if [ ! -d "node_modules" ]; then
  echo "📦 安装依赖..."
  npm install
fi

# 编译
echo "🔨 编译 TypeScript..."
npm run build

# 创建数据目录
mkdir -p /var/lib/openclaw-monitor

# 检查配置文件
if [ ! -f ".env" ]; then
  echo "⚠️  警告: 未找到 .env 配置文件"
  echo "   将使用默认配置（无认证）"
  echo "   生产环境请配置 API_KEY 环境变量"
fi

# 启动服务
echo "🚀 启动服务..."
echo ""
npm start
