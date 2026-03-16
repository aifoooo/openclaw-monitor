/**
 * 路由匹配单元测试
 * 测试文件：tests/unit/router.test.js
 */

const assert = require('assert');
const { loadRoutes, matchRoute, getAllProviders } = require('../../packages/proxy/dist/index.js');

// 测试配置
const TEST_ROUTES_CONFIG = {
  routes: {
    deepseek: {
      path: '/deepseek',
      target: 'https://api.deepseek.com',
      stripPath: true
    },
    tencentcodingplan: {
      path: '/tencentcodingplan',
      target: 'https://api.lkeap.cloud.tencent.com',
      stripPath: true
    }
  }
};

// 测试用例
const testCases = [
  // 正常匹配测试
  {
    name: '✅ 匹配 deepseek 路由',
    path: '/deepseek/v1/chat/completions',
    expected: {
      provider: 'deepseek',
      target: 'https://api.deepseek.com',
      targetPath: '/v1/chat/completions'
    }
  },
  {
    name: '✅ 匹配 tencentcodingplan 路由',
    path: '/tencentcodingplan/coding/v3/chat/completions',
    expected: {
      provider: 'tencentcodingplan',
      target: 'https://api.lkeap.cloud.tencent.com',
      targetPath: '/coding/v3/chat/completions'
    }
  },
  
  // 边界情况测试
  {
    name: '✅ 匹配根路径下的一级路径',
    path: '/deepseek',
    expected: {
      provider: 'deepseek',
      target: 'https://api.deepseek.com',
      targetPath: '/'
    }
  },
  {
    name: '✅ 路径末尾带斜杠',
    path: '/deepseek/',
    expected: {
      provider: 'deepseek',
      target: 'https://api.deepseek.com',
      targetPath: '/'
    }
  },
  
  // 不匹配测试
  {
    name: '❌ 不匹配的路由返回 null',
    path: '/unknown/v1/chat',
    expected: null
  },
  {
    name: '❌ 根路径不匹配',
    path: '/',
    expected: null
  },
  {
    name: '❌ 空路径不匹配',
    path: '',
    expected: null
  },
  {
    name: '❌ 健康检查端点不匹配路由',
    path: '/health',
    expected: null
  },
  
  // 特殊情况测试
  {
    name: '✅ 长路径正确匹配',
    path: '/tencentcodingplan/coding/v3/chat/completions?stream=true',
    expected: {
      provider: 'tencentcodingplan',
      target: 'https://api.lkeap.cloud.tencent.com',
      targetPath: '/coding/v3/chat/completions?stream=true'
    }
  }
];

// 运行测试
function runTests() {
  console.log('=== 路由匹配单元测试 ===\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const test of testCases) {
    try {
      const result = matchRoute(test.path, TEST_ROUTES_CONFIG);
      
      if (test.expected === null) {
        // 期望返回 null
        assert.strictEqual(result, null, `期望返回 null，实际返回 ${JSON.stringify(result)}`);
        console.log(`${test.name}: PASS`);
        passed++;
      } else {
        // 期望返回匹配结果
        assert.ok(result, '期望返回匹配结果，实际返回 null');
        assert.strictEqual(result.name, test.expected.provider, `provider 不匹配`);
        assert.strictEqual(result.config.target, test.expected.target, `target 不匹配`);
        assert.strictEqual(result.targetPath, test.expected.targetPath, `targetPath 不匹配`);
        console.log(`${test.name}: PASS`);
        passed++;
      }
    } catch (error) {
      console.log(`${test.name}: FAIL - ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\n=== 测试结果 ===`);
  console.log(`通过: ${passed}/${testCases.length}`);
  console.log(`失败: ${failed}/${testCases.length}`);
  
  return failed === 0;
}

// 导出测试函数
module.exports = { runTests, testCases };

// 如果直接运行，执行测试
if (require.main === module) {
  const success = runTests();
  process.exit(success ? 0 : 1);
}
