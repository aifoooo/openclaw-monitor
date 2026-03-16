#!/bin/bash
# 生成路由配置 - 从 openclaw.json 读取 providers

set -e

OPENCLAW_CONFIG="/root/.openclaw/openclaw.json"
ROUTES_CONFIG="/etc/openclaw-monitor/routes.json"

echo "=== 生成路由配置 ==="

# 确保 config 目录存在
mkdir -p /etc/openclaw-monitor

# 读取 providers 并生成路由配置
cat > /tmp/routes.tmp << 'EOF'
{
  "routes": {
EOF

first=true
jq -r '.models.providers | to_entries[] | "\(.key)|\(.value.baseUrl)"' "$OPENCLAW_CONFIG" | while IFS='|' read provider baseUrl; do
  if [ "$first" = true ]; then
    first=false
  else
    echo "," >> /tmp/routes.tmp
  fi
  
  cat >> /tmp/routes.tmp << EOF
    "$provider": {
      "path": "/$provider",
      "target": "$baseUrl",
      "stripPath": true
    }
EOF
done

cat >> /tmp/routes.tmp << 'EOF'
  }
}
EOF

# 移动到最终位置
mv /tmp/routes.tmp "$ROUTES_CONFIG"

echo "路由配置已生成: $ROUTES_CONFIG"
cat "$ROUTES_CONFIG"
