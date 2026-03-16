#!/bin/bash
# 配置使用代理 - 修改所有 provider 的 baseUrl 为代理地址

set -e

OPENCLAW_CONFIG="/root/.openclaw/openclaw.json"
ROUTES_CONFIG="/etc/openclaw-monitor/routes.json"

echo "=== 配置使用代理 ==="

# 读取路由配置中的 providers
providers=$(jq -r '.routes | keys[]' "$ROUTES_CONFIG")

for provider in $providers; do
  echo "配置 $provider ..."
  
  # 读取原始 baseUrl 的路径部分
  originalUrl=$(jq -r ".models.providers.$provider.baseUrl" "$OPENCLAW_CONFIG")
  
  # 提取路径部分（去掉域名）
  # 例如：https://api.lkeap.cloud.tencent.com/coding/v3 -> /coding/v3
  pathPart=$(echo "$originalUrl" | sed 's|^[^/]*//[^/]*||')
  
  # 修改为代理地址
  proxyUrl="http://localhost:38080/$provider$pathPart"
  
  echo "  $originalUrl -> $proxyUrl"
  
  # 修改配置
  tmpFile=$(mktemp)
  jq ".models.providers.$provider.baseUrl = \"$proxyUrl\"" "$OPENCLAW_CONFIG" > "$tmpFile"
  mv "$tmpFile" "$OPENCLAW_CONFIG"
done

echo ""
echo "配置已完成，重启 Gateway 生效"
echo "systemctl restart openclaw-gateway"
