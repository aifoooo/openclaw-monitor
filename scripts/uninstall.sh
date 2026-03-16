#!/bin/bash
# OpenClaw Monitor - 卸载脚本

set -e

echo "🦐 OpenClaw Monitor 卸载脚本"
echo "================================"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 默认配置
INSTALL_DIR="${INSTALL_DIR:-/root/ws-mime-qq/openclaw-monitor}"
LOG_DIR="${LOG_DIR:-/var/log/openclaw-monitor}"

# 确认卸载
confirm() {
    echo -e "${YELLOW}即将卸载 OpenClaw Monitor${NC}"
    echo ""
    echo "将删除："
    echo "  - 项目目录: $INSTALL_DIR"
    echo "  - 日志目录: $LOG_DIR"
    echo "  - systemd 服务"
    echo "  - cron 任务"
    echo ""
    read -p "确认卸载？(y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "取消卸载"
        exit 0
    fi
}

# 停止服务
stop_services() {
    echo -e "${YELLOW}停止服务...${NC}"
    
    systemctl stop openclaw-proxy 2>/dev/null || true
    systemctl disable openclaw-proxy 2>/dev/null || true
    
    echo -e "${GREEN}✓ 服务已停止${NC}"
}

# 删除 systemd 服务
remove_systemd_service() {
    echo -e "${YELLOW}删除 systemd 服务...${NC}"
    
    rm -f /etc/systemd/system/openclaw-proxy.service
    systemctl daemon-reload
    
    echo -e "${GREEN}✓ systemd 服务已删除${NC}"
}

# 删除 cron 任务
remove_cron() {
    echo -e "${YELLOW}删除 cron 任务...${NC}"
    
    crontab -l 2>/dev/null | grep -v "proxy-healthcheck.sh" | crontab - 2>/dev/null || true
    rm -f /usr/local/bin/proxy-healthcheck.sh
    
    echo -e "${GREEN}✓ cron 任务已删除${NC}"
}

# 恢复 OpenClaw 配置
restore_openclaw_config() {
    echo -e "${YELLOW}检查 OpenClaw 配置...${NC}"
    
    OPENCLAW_CONFIG="/root/.openclaw/openclaw.json"
    
    if [[ -f "$OPENCLAW_CONFIG.bak" ]]; then
        echo "发现备份配置，是否恢复？"
        read -p "恢复备份？(y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            mv "$OPENCLAW_CONFIG.bak" "$OPENCLAW_CONFIG"
            systemctl restart openclaw-gateway
            echo -e "${GREEN}✓ 配置已恢复${NC}"
        fi
    else
        echo "未发现备份配置"
    fi
}

# 删除项目文件
remove_files() {
    echo -e "${YELLOW}删除项目文件...${NC}"
    
    # 询问是否保留日志
    read -p "保留日志文件？(Y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        echo "日志文件已保留在: $LOG_DIR"
    else
        rm -rf "$LOG_DIR"
        echo -e "${GREEN}✓ 日志文件已删除${NC}"
    fi
    
    # 删除项目目录
    read -p "删除项目目录？(y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$INSTALL_DIR"
        echo -e "${GREEN}✓ 项目目录已删除${NC}"
    else
        echo "项目目录已保留在: $INSTALL_DIR"
    fi
}

# 显示结果
show_result() {
    echo ""
    echo "================================"
    echo -e "${GREEN}✅ 卸载完成${NC}"
    echo ""
    echo "如需重新安装，请运行："
    echo "  git clone https://github.com/aifoooo/openclaw-monitor.git"
    echo "  cd openclaw-monitor"
    echo "  sudo ./scripts/install.sh"
    echo ""
}

# 主流程
main() {
    confirm
    stop_services
    remove_systemd_service
    remove_cron
    restore_openclaw_config
    remove_files
    show_result
}

main "$@"
