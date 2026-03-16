#!/bin/bash
# 测试运行器
# 文件：tests/run-tests.sh
# 用途：运行所有测试用例

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== OpenClaw Monitor 多路由代理系统 - 测试套件 ===${NC}\n"

# 设置权限
chmod +x /root/ws-mime-qq/openclaw-monitor/tests/scripts/*.sh

# 计数器
total_passed=0
total_failed=0

# 运行单元测试
echo -e "${BLUE}>>> 运行路由匹配单元测试 <<<${NC}"
node /root/ws-mime-qq/openclaw-monitor/tests/unit/router.test.js
if [ $? -eq 0 ]; then
    ((total_passed++))
else
    ((total_failed++))
fi
echo ""

# 运行脚本测试
echo -e "${BLUE}>>> 运行配置生成脚本测试 <<<${NC}"
bash /root/ws-mime-qq/openclaw-monitor/tests/scripts/generate-routes.test.sh
if [ $? -eq 0 ]; then
    ((total_passed++))
else
    ((total_failed++))
fi
echo ""

echo -e "${BLUE}>>> 运行配置切换脚本测试 <<<${NC}"
bash /root/ws-mime-qq/openclaw-monitor/tests/scripts/configure-proxy.test.sh
if [ $? -eq 0 ]; then
    ((total_passed++))
else
    ((total_failed++))
fi
echo ""

# 运行集成测试（需要启动代理服务）
echo -e "${BLUE}>>> 运行端到端集成测试 <<<${NC}"
node /root/ws-mime-qq/openclaw-monitor/tests/integration/e2e.test.js
if [ $? -eq 0 ]; then
    ((total_passed++))
else
    ((total_failed++))
fi
echo ""

# 输出总结
echo -e "${BLUE}=== 测试总结 ===${NC}"
echo -e "通过: ${GREEN}$total_passed${NC}"
echo -e "失败: ${RED}$total_failed${NC}"

if [ $total_failed -eq 0 ]; then
    echo -e "${GREEN}所有测试通过！${NC}"
    exit 0
else
    echo -e "${RED}有测试失败！${NC}"
    exit 1
fi
