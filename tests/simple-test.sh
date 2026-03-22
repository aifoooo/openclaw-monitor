#!/bin/bash
# 简化的测试脚本 - 验证点击一次发几次请求
echo "=== 简化测试：验证修复效果 ==="

echo "1. 重启服务，清理环境"
systemctl restart openclaw-monitor
sleep 3

echo "2. 打开页面"
agent-browser open "http://localhost:5173/?token=7f7cc8be30d13703dc35e518ccba3c8ff30c2525cefaa05208a9a328f16483ed" > /dev/null 2>&1
sleep 3

echo "3. 测试点击行为"
echo "| 测试 | 请求数 | 结果 |"
echo "|------|--------|------|"

for i in 1 2 3; do
  # 记录点击前时间
  CLICK_TIME=$(date '+%Y-%m-%d %H:%M:%S')
  
  # 点击聊天
  agent-browser eval "document.querySelectorAll('.chat-item')[0]?.click()" > /dev/null 2>&1
  sleep 2
  
  # 统计这次点击的请求数
  REQUEST_COUNT=$(journalctl -u openclaw-monitor --since "$CLICK_TIME" --no-pager 2>/dev/null | grep "\[API\] GET.*messages" | wc -l)
  
  if [ "$REQUEST_COUNT" = "1" ]; then
    echo "| 第${i}次 | 1次 | ✅ 正确 |"
  else
    echo "| 第${i}次 | ${REQUEST_COUNT}次 | ❌ 异常 |"
  fi
done

echo ""
echo "测试完成！"