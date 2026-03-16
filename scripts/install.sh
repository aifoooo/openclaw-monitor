#!/bin/bash
# OpenClaw Monitor - 安装脚本

set -e

echo "🦐 OpenClaw Monitor 安装脚本"
echo "================================"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 解析命令行参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --dir|-d)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --log-dir|-l)
            LOG_DIR="$2"
            shift 2
            ;;
        --help|-h)
            echo "用法: $0 [选项]"
            echo ""
            echo "选项:"
            echo "  --dir, -d DIR      安装目录 (默认: 当前目录)"
            echo "  --log-dir, -l DIR  日志目录 (默认: /var/log/openclaw-monitor)"
            echo "  --help, -h         显示帮助"
            exit 0
            ;;
        *)
            echo "未知选项: $1"
            exit 1
            ;;
    esac
done

# 默认配置
INSTALL_DIR="${INSTALL_DIR:-$(pwd)}"
LOG_DIR="${LOG_DIR:-/var/log/openclaw-monitor}"
OPENCLAW_CONFIG="${OPENCLAW_CONFIG:-/root/.openclaw/openclaw.json}"

echo "安装配置:"
echo "  - 安装目录: $INSTALL_DIR"
echo "  - 日志目录: $LOG_DIR"
echo ""

# 检查依赖
check_dependencies() {
    echo -e "${YELLOW}检查依赖...${NC}"
    
    local missing=()
    
    # 检查 Node.js
    if ! command -v node &> /dev/null; then
        missing+=("node")
    fi
    
    # 检查 pnpm
    if ! command -v pnpm &> /dev/null; then
        missing+=("pnpm")
    fi
    
    # 检查 jq
    if ! command -v jq &> /dev/null; then
        missing+=("jq")
    fi
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        echo -e "${RED}缺少依赖: ${missing[*]}${NC}"
        echo "请先安装缺少的依赖"
        exit 1
    fi
    
    echo -e "${GREEN}✓ 依赖检查通过${NC}"
}

# 创建日志目录
create_log_dir() {
    echo -e "${YELLOW}创建日志目录...${NC}"
    mkdir -p "$LOG_DIR"
    echo -e "${GREEN}✓ 日志目录: $LOG_DIR${NC}"
}

# 安装依赖
install_dependencies() {
    echo -e "${YELLOW}安装项目依赖...${NC}"
    cd "$INSTALL_DIR"
    pnpm install
    echo -e "${GREEN}✓ 依赖安装完成${NC}"
}

# 构建项目
build_project() {
    echo -e "${YELLOW}构建项目...${NC}"
    cd "$INSTALL_DIR"
    pnpm build
    echo -e "${GREEN}✓ 构建完成${NC}"
}

# 安装 systemd 服务
install_systemd_service() {
    echo -e "${YELLOW}安装 systemd 服务...${NC}"
    
    # 替换路径并安装代理服务
    sed -e "s|/root/ws-mime-qq/openclaw-monitor|$INSTALL_DIR|g" \
        -e "s|/var/log/openclaw-monitor|$LOG_DIR|g" \
        "$INSTALL_DIR/scripts/openclaw-proxy.service" > /etc/systemd/system/openclaw-proxy.service
    
    # 替换路径并安装后端服务
    sed -e "s|/root/ws-mime-qq/openclaw-monitor|$INSTALL_DIR|g" \
        -e "s|/var/log/openclaw-monitor|$LOG_DIR|g" \
        "$INSTALL_DIR/scripts/openclaw-backend.service" > /etc/systemd/system/openclaw-backend.service
    
    # 重新加载 systemd
    systemctl daemon-reload
    
    # 启用服务
    systemctl enable openclaw-proxy
    systemctl enable openclaw-backend
    
    echo -e "${GREEN}✓ systemd 服务已安装${NC}"
}

# 安装健康检查脚本
install_healthcheck() {
    echo -e "${YELLOW}安装健康检查脚本...${NC}"
    
    # 替换路径并复制脚本
    sed -e "s|/root/ws-mime-qq/openclaw-monitor|$INSTALL_DIR|g" \
        -e "s|/var/log/openclaw-monitor|$LOG_DIR|g" \
        "$INSTALL_DIR/scripts/proxy-healthcheck.sh" > /usr/local/bin/proxy-healthcheck.sh
    chmod +x /usr/local/bin/proxy-healthcheck.sh
    
    # 添加 cron 任务
    (crontab -l 2>/dev/null | grep -v "proxy-healthcheck.sh"; echo "* * * * * /usr/local/bin/proxy-healthcheck.sh") | crontab -
    
    echo -e "${GREEN}✓ 健康检查脚本已安装${NC}"
}

# 配置 OpenClaw
configure_openclaw() {
    echo -e "${YELLOW}配置 OpenClaw...${NC}"
    
    if [[ ! -f "$OPENCLAW_CONFIG" ]]; then
        echo -e "${RED}OpenClaw 配置文件不存在: $OPENCLAW_CONFIG${NC}"
        echo "请先配置 OpenClaw"
        exit 1
    fi
    
    # 备份配置
    cp "$OPENCLAW_CONFIG" "$OPENCLAW_CONFIG.bak"
    
    # 修改 baseUrl
    local proxy_url="http://localhost:38080/v3"
    jq --arg url "$proxy_url" \
        '.models.providers.tencentcodingplan.baseUrl = $url' \
        "$OPENCLAW_CONFIG" > "$OPENCLAW_CONFIG.tmp" && \
        mv "$OPENCLAW_CONFIG.tmp" "$OPENCLAW_CONFIG"
    
    echo -e "${GREEN}✓ OpenClaw 配置已更新${NC}"
}

# 启动服务
start_services() {
    echo -e "${YELLOW}启动服务...${NC}"
    
    # 启动代理
    systemctl start openclaw-proxy
    
    # 等待代理启动
    sleep 2
    
    # 检查代理是否正常
    if curl -s http://localhost:38080/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ 代理服务正常${NC}"
    else
        echo -e "${RED}⚠ 代理服务启动失败，请检查日志${NC}"
    fi
    
    # 启动后端
    systemctl start openclaw-backend
    
    # 等待后端启动
    sleep 2
    
    # 检查后端是否正常
    if curl -s http://localhost:3000/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ 后端服务正常${NC}"
    else
        echo -e "${RED}⚠ 后端服务启动失败，请检查日志${NC}"
    fi
    
    # 重启 OpenClaw Gateway
    systemctl restart openclaw-gateway
    
    echo -e "${GREEN}✓ 服务已启动${NC}"
}

# 显示状态
show_status() {
    echo ""
    echo "================================"
    echo -e "${GREEN}✅ 安装完成！${NC}"
    echo ""
    echo "服务状态:"
    echo "  - 代理服务: $(systemctl is-active openclaw-proxy 2>/dev/null || echo 'unknown')"
    echo "  - 后端服务: $(systemctl is-active openclaw-backend 2>/dev/null || echo 'unknown')"
    echo "  - Gateway: $(systemctl is-active openclaw-gateway 2>/dev/null || echo 'unknown')"
    echo ""
    echo "安装位置:"
    echo "  - 项目目录: $INSTALL_DIR"
    echo "  - 日志目录: $LOG_DIR"
    echo ""
    echo "常用命令:"
    echo "  - 查看代理状态: systemctl status openclaw-proxy"
    echo "  - 查看后端状态: systemctl status openclaw-backend"
    echo "  - 查看代理日志: journalctl -u openclaw-proxy -f"
    echo "  - 查看后端日志: journalctl -u openclaw-backend -f"
    echo "  - 重启代理: systemctl restart openclaw-proxy"
    echo "  - 重启后端: systemctl restart openclaw-backend"
    echo "  - 代理健康检查: curl http://localhost:38080/health"
    echo "  - 后端健康检查: curl http://localhost:3000/health"
    echo ""
    echo "卸载:"
    echo "  - $INSTALL_DIR/scripts/uninstall.sh"
    echo ""
}

# 主流程
main() {
    check_dependencies
    create_log_dir
    install_dependencies
    build_project
    install_systemd_service
    install_healthcheck
    configure_openclaw
    start_services
    show_status
}

main "$@"
