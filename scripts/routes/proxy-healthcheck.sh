#!/bin/bash
# 健康检查 - 检测代理状态，自动切换配置

set -e

LOCK_FILE="/tmp/proxy-healthcheck.lock"
STATE_FILE="/tmp/proxy-healthcheck.state"
COOLDOWN_SECONDS=300  # 5 分钟冷却期

# 检查锁文件
if [ -f "$LOCK_FILE" ]; then
  pid=$(cat "$LOCK_FILE")
  if ps -p "$pid" > /dev/null 2>&1; then
    echo "另一个健康检查进程正在运行，退出"
    exit 0
  fi
fi

# 创建锁文件
echo $$ > "$LOCK_FILE"
trap "rm -f $LOCK_FILE" EXIT

# 检测代理
if curl -s --max-time 5 http://localhost:38080/health > /dev/null; then
  PROXY_STATUS="up"
else
  PROXY_STATUS="down"
fi

# 读取上次状态
if [ -f "$STATE_FILE" ]; then
  LAST_STATUS=$(jq -r '.status' "$STATE_FILE")
  LAST_SWITCH=$(jq -r '.lastSwitch // 0' "$STATE_FILE")
else
  LAST_STATUS="unknown"
  LAST_SWITCH=0
fi

CURRENT_TIME=$(date +%s)

echo "$(date '+%Y-%m-%d %H:%M:%S') - 代理状态: $PROXY_STATUS (上次: $LAST_STATUS)"

# 判断是否需要切换
if [ "$PROXY_STATUS" = "down" ] && [ "$LAST_STATUS" != "down" ]; then
  # 检查冷却期
  if [ $((CURRENT_TIME - LAST_SWITCH)) -lt $COOLDOWN_SECONDS ]; then
    echo "冷却期内，跳过切换"
    exit 0
  fi
  
  echo "代理不可用，切换到直连"
  /opt/openclaw-monitor/scripts/routes/restore-direct.sh
  
  # 更新状态
  jq -n --arg status "down" --arg lastSwitch "$CURRENT_TIME" \
    '{status: $status, lastSwitch: ($lastSwitch | tonumber)}' > "$STATE_FILE"
  
elif [ "$PROXY_STATUS" = "up" ] && [ "$LAST_STATUS" = "down" ]; then
  echo "代理恢复，切换到代理"
  /opt/openclaw-monitor/scripts/routes/configure-proxy.sh
  systemctl restart openclaw-gateway
  
  # 更新状态
  jq -n --arg status "up" --arg lastSwitch "$CURRENT_TIME" \
    '{status: $status, lastSwitch: ($lastSwitch | tonumber)}' > "$STATE_FILE"
fi
