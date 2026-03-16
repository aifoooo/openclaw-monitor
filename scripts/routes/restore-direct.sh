#!/bin/bash
# 恢复直连 - 恢复所有 provider 的原始 baseUrl

set -e

OPENCLAW_CONFIG="/root/.openclaw/openclaw.json"
ROUTES_CONFIG="/etc/openclaw-monitor/routes.json"

echo "=== 恢复直连 ==="

# 读取路由配置中的 providers 和原始 target
jq -r '.routes | to_entries[] | "\(.key)|\(.value.target)"' "$ROUTES_CONFIG" | while IFS='|' read provider target; do
  echo "恢复 $provider ..."
  
  # 读取当前配置中的路径部分
  currentUrl=$(jq -r ".models.providers.$provider.baseUrl" "$OPENCLAW_CONFIG")
  pathPart=$(echo "$currentUrl" | sed 's|http://localhost:38080/[^/]*||')
  
  # 恢复原始 baseUrl
  originalUrl="$target$pathPart"
  
  echo "  $currentUrl -> $originalUrl"
  
  # 修改配置
  tmpFile=$(mktemp)
  jq ".models.providers.$provider.baseUrl = \"$originalUrl\"" "$OPENCLAW_CONFIG" > "$tmpFile"
  mv "$tmpFile" "$OPENCLAW_CONFIG"
done

echo ""
echo "配置已恢复，重启 Gateway 生效"
systemctl restart openclaw-gateway
