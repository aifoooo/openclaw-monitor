#!/bin/bash
# OpenClaw Monitor - 代理健康检查脚本
# 用于检测代理是否可用，自动切换配置

set -e

# 配置
PROXY_URL="${PROXY_URL:-http://localhost:38080/health}"
CONFIG_FILE="${CONFIG_FILE:-/root/.openclaw/openclaw.json}"
LOG_DIR="${LOG_DIR:-/var/log/openclaw-monitor}"
LOG_FILE="$LOG_DIR/proxy-healthcheck.log"
LOCK_FILE="/tmp/proxy-healthcheck.lock"
COOLDOWN_FILE="/tmp/proxy-healthcheck-cooldown"
COOLDOWN_SECONDS=300  # 切换后冷却 5 分钟

# 代理和直连的 baseUrl
PROXY_BASEURL="http://localhost:38080/v3"
DIRECT_BASEURL="https://api.lkeap.cloud.tencent.com/coding/v3"

# 确保日志目录存在
mkdir -p "$LOG_DIR"

# 日志函数
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

# 检查冷却期
check_cooldown() {
    if [[ -f "$COOLDOWN_FILE" ]]; then
        local last_switch=$(cat "$COOLDOWN_FILE")
        local now=$(date +%s)
        local elapsed=$((now - last_switch))
        
        if [[ $elapsed -lt $COOLDOWN_SECONDS ]]; then
            log "冷却期中，剩余 $((COOLDOWN_SECONDS - elapsed)) 秒"
            exit 0
        fi
    fi
}

# 获取当前 baseUrl
get_current_baseurl() {
    jq -r '.models.providers.tencentcodingplan.baseUrl' "$CONFIG_FILE" 2>/dev/null || echo ""
}

# 检测代理是否可用
check_proxy() {
    curl -s --max-time 5 "$PROXY_URL" > /dev/null 2>&1
    return $?
}

# 切换到直连
switch_to_direct() {
    local current=$(get_current_baseurl)
    if [[ "$current" == *"localhost"* ]] || [[ -z "$current" ]]; then
        log "代理不可用，切换到直连"
        
        # 备份配置
        cp "$CONFIG_FILE" "$CONFIG_FILE.bak"
        
        # 修改配置
        jq --arg url "$DIRECT_BASEURL" \
            '.models.providers.tencentcodingplan.baseUrl = $url' \
            "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && \
            mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
        
        # 记录冷却时间
        date +%s > "$COOLDOWN_FILE"
        
        # 重启 Gateway
        systemctl restart openclaw-gateway
        
        log "已切换到直连模式"
    fi
}

# 切换到代理
switch_to_proxy() {
    local current=$(get_current_baseurl)
    if [[ "$current" != *"localhost"* ]]; then
        log "代理恢复，切换回代理"
        
        # 备份配置
        cp "$CONFIG_FILE" "$CONFIG_FILE.bak"
        
        # 修改配置
        jq --arg url "$PROXY_BASEURL" \
            '.models.providers.tencentcodingplan.baseUrl = $url' \
            "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && \
            mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
        
        # 记录冷却时间
        date +%s > "$COOLDOWN_FILE"
        
        # 重启 Gateway
        systemctl restart openclaw-gateway
        
        log "已切换回代理模式"
    fi
}

# 主逻辑
main() {
    # 检查锁文件，防止并发执行
    if [[ -f "$LOCK_FILE" ]]; then
        log "脚本已在运行，跳过"
        exit 0
    fi
    
    # 创建锁文件
    echo $$ > "$LOCK_FILE"
    trap "rm -f $LOCK_FILE" EXIT
    
    # 检查冷却期
    check_cooldown
    
    # 检测代理并切换
    if check_proxy; then
        switch_to_proxy
    else
        switch_to_direct
    fi
}

main "$@"
