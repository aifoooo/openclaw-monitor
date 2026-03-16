/**
 * 代理转发单元测试
 * 测试文件：tests/unit/proxy.test.js
 * 
 * 注意：需要启动代理服务才能运行此测试
 */

const http = require('http');
const assert = require('assert');

// 测试配置
const PROXY_HOST = 'localhost';
const PROXY_PORT = 38080;
const PROXY_URL = `http://${PROXY_HOST}:${PROXY_PORT}`;

// 测试用例
const testCases = [
  // 健康检查测试
  {
    name: '✅ 健康检查端点返回 200',
    method: 'GET',
    path: '/health',
    expected: {
      status: 200,
      validate: (body) => {
        const data = JSON.parse(body);
        assert.strictEqual(data.status, 'ok', '状态应该是 ok');
        assert.ok(data.uptime >= 0, 'uptime 应该大于等于 0');
        assert.ok(Array.isArray(data.providers), 'providers 应该是数组');
      }
    }
  },
  
  // 就绪检查测试
  {
    name: '✅ 就绪检查端点返回 200',
    method: 'GET',
    path: '/ready',
    expected: {
      status: 200,
      validate: (body) => {
        const data = JSON.parse(body);
        assert.strictEqual(data.ready, true, 'ready 应该是 true');
      }
    }
  },
  
  // 路由不存在测试
  {
    name: '❌ 未知路由返回 404',
    method: 'POST',
    path: '/unknown/v1/chat',
    body: JSON.stringify({ model: 'test' }),
    expected: {
      status: 404,
      validate: (body) => {
        const data = JSON.parse(body);
        assert.strictEqual(data.error, 'Route not found', '错误信息应该是 Route not found');
        assert.ok(Array.isArray(data.availableRoutes), 'availableRoutes 应该是数组');
      }
    }
  }
];

// 发送 HTTP 请求
function sendRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: PROXY_HOST,
      port: PROXY_PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    if (body) {
      req.write(body);
    }
    
    req.end();
  });
}

// 运行测试
async function runTests() {
  console.log('=== 代理转发单元测试 ===\n');
  console.log(`代理地址: ${PROXY_URL}\n`);
  
  let passed = 0;
  let failed = 0;
  
  for (const test of testCases) {
    try {
      console.log(`测试: ${test.name}`);
      
      const response = await sendRequest(test.method, test.path, test.body);
      
      // 验证状态码
      assert.strictEqual(response.status, test.expected.status, 
        `状态码不匹配: 期望 ${test.expected.status}, 实际 ${response.status}`);
      
      // 验证响应体
      if (test.expected.validate) {
        test.expected.validate(response.body);
      }
      
      console.log(`  结果: PASS\n`);
      passed++;
    } catch (error) {
      console.log(`  结果: FAIL - ${error.message}\n`);
      failed++;
    }
  }
  
  console.log(`=== 测试结果 ===`);
  console.log(`通过: ${passed}/${testCases.length}`);
  console.log(`失败: ${failed}/${testCases.length}`);
  
  return failed === 0;
}

// 导出测试函数
module.exports = { runTests, testCases, sendRequest };

// 如果直接运行，执行测试
if (require.main === module) {
  runTests()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('测试执行失败:', error);
      process.exit(1);
    });
}
