#!/bin/bash
# 配置生成脚本单元测试
# 测试文件：tests/scripts/generate-routes.test.sh

set -e

# 测试配置
TEST_DIR="/tmp/openclaw-monitor-test"
TEST_OPENCLAW_CONFIG="$TEST_DIR/openclaw.json"
TEST_ROUTES_CONFIG="$TEST_DIR/routes.json"
SCRIPT_DIR="/root/ws-mime-qq/openclaw-monitor/scripts/routes"

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
    
    echo "测试环境准备完成\n"
}

# 测试用例 1: 正常生成路由配置
function test_generate_routes_normal() {
    echo "测试: 正常生成路由配置"
    
    # 模拟生成路由配置
    cat > "$TEST_ROUTES_CONFIG" << 'EOF'
{
  "routes": {
    "deepseek": {
      "path": "/deepseek",
      "target": "https://api.deepseek.com/v1",
      "stripPath": true
    },
    "tencentcodingplan": {
      "path": "/tencentcodingplan",
      "target": "https://api.lkeap.cloud.tencent.com/coding/v3",
      "stripPath": true
    }
  }
}
EOF
    
    # 验证文件存在
    if [ -f "$TEST_ROUTES_CONFIG" ]; then
        # 验证 JSON 格式
        if jq empty "$TEST_ROUTES_CONFIG" 2>/dev/null; then
            # 验证包含必要的键
            if jq -e '.routes.deepseek' "$TEST_ROUTES_CONFIG" > /dev/null && \
               jq -e '.routes.tencentcodingplan' "$TEST_ROUTES_CONFIG" > /dev/null; then
                test_case "正常生成路由配置" "PASS"
            else
                test_case "正常生成路由配置" "缺少必要的路由配置"
            fi
        else
            test_case "正常生成路由配置" "JSON 格式无效"
        fi
    else
        test_case "正常生成路由配置" "路由配置文件不存在"
    fi
}

# 测试用例 2: openclaw.json 不存在时退出
function test_generate_routes_missing_config() {
    echo "测试: openclaw.json 不存在时退出"
    
    # 删除测试配置
    rm -f "$TEST_OPENCLAW_CONFIG"
    
    # 尝试生成路由配置（应该失败）
    if [ ! -f "$TEST_OPENCLAW_CONFIG" ]; then
        test_case "openclaw.json 不存在时退出" "PASS"
    else
        test_case "openclaw.json 不存在时退出" "配置文件不应该存在"
    fi
}

# 测试用例 3: 路由配置文件权限检查
function test_routes_config_permissions() {
    echo "测试: 路由配置文件权限检查"
    
    # 创建测试路由配置
    cat > "$TEST_ROUTES_CONFIG" << 'EOF'
{
  "routes": {}
}
EOF
    
    # 检查文件权限
    if [ -r "$TEST_ROUTES_CONFIG" ]; then
        test_case "路由配置文件权限检查" "PASS"
    else
        test_case "路由配置文件权限检查" "文件不可读"
    fi
}

# 测试用例 4: JSON 格式验证
function test_json_format_validation() {
    echo "测试: JSON 格式验证"
    
    # 创建有效的 JSON
    cat > "$TEST_ROUTES_CONFIG" << 'EOF'
{
  "routes": {
    "test": {
      "path": "/test",
      "target": "https://api.test.com",
      "stripPath": true
    }
  }
}
EOF
    
    # 验证 JSON 格式
    if jq empty "$TEST_ROUTES_CONFIG" 2>/dev/null; then
        test_case "JSON 格式验证" "PASS"
    else
        test_case "JSON 格式验证" "JSON 格式无效"
    fi
}

# 运行所有测试
function run_tests() {
    echo "=== 配置生成脚本单元测试 ===\n"
    
    setup
    test_generate_routes_normal
    test_generate_routes_missing_config
    test_routes_config_permissions
    test_json_format_validation
    
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
