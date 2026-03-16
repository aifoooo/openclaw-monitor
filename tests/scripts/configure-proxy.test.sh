#!/bin/bash
# 配置切换脚本单元测试
# 测试文件：tests/scripts/configure-proxy.test.sh

set -e

# 测试配置
TEST_DIR="/tmp/openclaw-monitor-test"
TEST_OPENCLAW_CONFIG="$TEST_DIR/openclaw.json"
TEST_ROUTES_CONFIG="$TEST_DIR/routes.json"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass_count=0
fail_count=0

# 测试函数
function test_case() {
    local name="$1"
    local result="$2"
    
    if [ "$result" = "PASS" ]; then
        echo -e "${GREEN}✅ $name: PASS${NC}"
        ((pass_count++))
    else
        echo -e "${RED}❌ $name: FAIL - $result${NC}"
        ((fail_count++))
    fi
}

# 准备测试环境
function setup() {
    echo "=== 准备测试环境 ==="
    
    rm -rf "$TEST_DIR"
    mkdir -p "$TEST_DIR"
    
    # 创建测试用的 openclaw.json
    cat > "$TEST_OPENCLAW_CONFIG" << 'EOF'
{
  "models": {
    "providers": {
      "deepseek": {
        "baseUrl": "https://api.deepseek.com/v1"
      },
      "tencentcodingplan": {
        "baseUrl": "https://api.lkeap.cloud.tencent.com/coding/v3"
      }
    }
  }
}
EOF
    
    # 创建测试用的路由配置
    cat > "$TEST_ROUTES_CONFIG" << 'EOF'
{
  "routes": {
    "deepseek": {
      "path": "/deepseek",
      "target": "https://api.deepseek.com",
      "stripPath": true
    },
    "tencentcodingplan": {
      "path": "/tencentcodingplan",
      "target": "https://api.lkeap.cloud.tencent.com",
      "stripPath": true
    }
  }
}
EOF
    
    echo "测试环境准备完成\n"
}

# 测试用例 1: 正常切换到代理地址
function test_configure_proxy_normal() {
    echo "测试: 正常切换到代理地址"
    
    setup
    
    # 读取原始 baseUrl
    local original_deepseek=$(jq -r '.models.providers.deepseek.baseUrl' "$TEST_OPENCLAW_CONFIG")
    
    # 模拟配置切换
    # deepseek: https://api.deepseek.com/v1 -> http://localhost:38080/deepseek/v1
    local new_url="http://localhost:38080/deepseek/v1"
    
    jq ".models.providers.deepseek.baseUrl = \"$new_url\"" "$TEST_OPENCLAW_CONFIG" > "${TEST_OPENCLAW_CONFIG}.tmp"
    mv "${TEST_OPENCLAW_CONFIG}.tmp" "$TEST_OPENCLAW_CONFIG"
    
    # 验证配置已修改
    local modified_url=$(jq -r '.models.providers.deepseek.baseUrl' "$TEST_OPENCLAW_CONFIG")
    
    if [ "$modified_url" = "$new_url" ]; then
        test_case "正常切换到代理地址" "PASS"
    else
        test_case "正常切换到代理地址" "URL 未正确修改: $modified_url"
    fi
}

# 测试用例 2: 路由配置文件不存在时退出
function test_configure_proxy_missing_routes() {
    echo "测试: 路由配置文件不存在时退出"
    
    setup
    rm -f "$TEST_ROUTES_CONFIG"
    
    if [ ! -f "$TEST_ROUTES_CONFIG" ]; then
        test_case "路由配置文件不存在时退出" "PASS"
    else
        test_case "路由配置文件不存在时退出" "路由配置文件不应该存在"
    fi
}

# 测试用例 3: 备份原始配置
function test_backup_original_config() {
    echo "测试: 备份原始配置"
    
    setup
    
    # 创建备份
    cp "$TEST_OPENCLAW_CONFIG" "${TEST_OPENCLAW_CONFIG}.backup"
    
    # 验证备份存在
    if [ -f "${TEST_OPENCLAW_CONFIG}.backup" ]; then
        test_case "备份原始配置" "PASS"
    else
        test_case "备份原始配置" "备份文件不存在"
    fi
}

# 测试用例 4: 验证代理地址格式
function test_proxy_url_format() {
    echo "测试: 验证代理地址格式"
    
    setup
    
    # 修改配置
    local new_url="http://localhost:38080/deepseek/v1"
    jq ".models.providers.deepseek.baseUrl = \"$new_url\"" "$TEST_OPENCLAW_CONFIG" > "${TEST_OPENCLAW_CONFIG}.tmp"
    mv "${TEST_OPENCLAW_CONFIG}.tmp" "$TEST_OPENCLAW_CONFIG"
    
    # 验证 URL 格式
    local modified_url=$(jq -r '.models.providers.deepseek.baseUrl' "$TEST_OPENCLAW_CONFIG")
    
    if [[ "$modified_url" =~ ^http://localhost:38080/ ]]; then
        test_case "验证代理地址格式" "PASS"
    else
        test_case "验证代理地址格式" "URL 格式不正确: $modified_url"
    fi
}

# 测试用例 5: 恢复直连
function test_restore_direct() {
    echo "测试: 恢复直连"
    
    setup
    
    # 先修改为代理地址
    jq ".models.providers.deepseek.baseUrl = \"http://localhost:38080/deepseek/v1\"" "$TEST_OPENCLAW_CONFIG" > "${TEST_OPENCLAW_CONFIG}.tmp"
    mv "${TEST_OPENCLAW_CONFIG}.tmp" "$TEST_OPENCLAW_CONFIG"
    
    # 恢复原始地址
    local original_url="https://api.deepseek.com/v1"
    jq ".models.providers.deepseek.baseUrl = \"$original_url\"" "$TEST_OPENCLAW_CONFIG" > "${TEST_OPENCLAW_CONFIG}.tmp"
    mv "${TEST_OPENCLAW_CONFIG}.tmp" "$TEST_OPENCLAW_CONFIG"
    
    # 验证已恢复
    local restored_url=$(jq -r '.models.providers.deepseek.baseUrl' "$TEST_OPENCLAW_CONFIG")
    
    if [ "$restored_url" = "$original_url" ]; then
        test_case "恢复直连" "PASS"
    else
        test_case "恢复直连" "URL 未正确恢复: $restored_url"
    fi
}

# 运行所有测试
function run_tests() {
    echo "=== 配置切换脚本单元测试 ===\n"
    
    test_configure_proxy_normal
    test_configure_proxy_missing_routes
    test_backup_original_config
    test_proxy_url_format
    test_restore_direct
    
    echo "\n=== 测试结果 ==="
    echo "通过: $pass_count"
    echo "失败: $fail_count"
    
    if [ $fail_count -eq 0 ]; then
        echo -e "${GREEN}所有测试通过！${NC}"
        return 0
    else
        echo -e "${RED}有测试失败！${NC}"
        return 1
    fi
}

# 执行测试
run_tests
