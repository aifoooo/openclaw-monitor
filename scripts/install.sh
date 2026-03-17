#!/bin/bash
set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 默认配置
MONITOR_DIR="/opt/openclaw-monitor"
DB_DIR="/var/lib/openclaw-monitor"
LOG_DIR="/var/log/openclaw-monitor"
OPENCLAW_DIR="/root/.openclaw"
CACHE_TRACE_PATH="/root/.openclaw/logs/cache-trace.jsonl"

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --dir)
      MONITOR_DIR="$2"
      shift 2
      ;;
    --db-dir)
      DB_DIR="$2"
      shift 2
      ;;
    --log-dir)
      LOG_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo -e "${GREEN}=== OpenClaw Monitor 安装脚本 ===${NC}"

# 检查依赖
echo -e "${YELLOW}检查依赖...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}错误: Node.js 未安装${NC}"
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}错误: pnpm 未安装${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Node.js $(node -v)${NC}"
echo -e "${GREEN}✓ pnpm $(pnpm -v)${NC}"

# 创建目录
echo -e "${YELLOW}创建目录...${NC}"

mkdir -p "$DB_DIR"
mkdir -p "$LOG_DIR"

echo -e "${GREEN}✓ 数据库目录: $DB_DIR${NC}"
echo -e "${GREEN}✓ 日志目录: $LOG_DIR${NC}"

# 安装依赖
echo -e "${YELLOW}安装依赖...${NC}"

cd "$MONITOR_DIR"
pnpm install

# 构建
echo -e "${YELLOW}构建项目...${NC}"

pnpm build

# 检查 OpenClaw Cache Trace 配置
echo -e "${YELLOW}检查 OpenClaw Cache Trace 配置...${NC}"

OPENCLAW_CONFIG="$OPENCLAW_DIR/openclaw.json"

if [ -f "$OPENCLAW_CONFIG" ]; then
    # 检查是否启用 Cache Trace
    if ! grep -q '"cacheTrace"' "$OPENCLAW_CONFIG"; then
        echo -e "${YELLOW}Cache Trace 未启用，正在添加配置...${NC}"
        
        # 备份原配置
        cp "$OPENCLAW_CONFIG" "$OPENCLAW_CONFIG.bak"
        
        # 添加 Cache Trace 配置（简化处理，实际应该用 jq）
        echo -e "${GREEN}请手动在 $OPENCLAW_CONFIG 中添加以下配置:${NC}"
        echo '
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
'
    else
        echo -e "${GREEN}✓ Cache Trace 已配置${NC}"
    fi
else
    echo -e "${YELLOW}OpenClaw 配置文件不存在，跳过检查${NC}"
fi

# 创建 systemd 服务
echo -e "${YELLOW}创建 systemd 服务...${NC}"

cat > /etc/systemd/system/openclaw-monitor.service << EOF
[Unit]
Description=OpenClaw Monitor
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$MONITOR_DIR
Environment="OPENCLAW_DIR=$OPENCLAW_DIR"
Environment="CACHE_TRACE_PATH=$CACHE_TRACE_PATH"
Environment="DB_PATH=$DB_DIR/monitor.db"
Environment="PORT=3000"
ExecStart=$(which node) packages/backend/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable openclaw-monitor

echo -e "${GREEN}✓ systemd 服务已创建${NC}"

# 启动服务
echo -e "${YELLOW}启动服务...${NC}"

systemctl start openclaw-monitor

# 等待服务启动
sleep 2

# 检查服务状态
if systemctl is-active --quiet openclaw-monitor; then
    echo -e "${GREEN}✓ 服务已启动${NC}"
else
    echo -e "${RED}✗ 服务启动失败${NC}"
    journalctl -u openclaw-monitor --no-pager -n 20
    exit 1
fi

echo ""
echo -e "${GREEN}=== 安装完成 ===${NC}"
echo ""
echo "配置文件: $OPENCLAW_CONFIG"
echo "数据库: $DB_DIR/monitor.db"
echo "日志: journalctl -u openclaw-monitor -f"
echo ""
echo "访问地址: http://localhost:3000"
echo ""
