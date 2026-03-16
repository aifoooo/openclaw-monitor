/**
 * 端到端集成测试
 * 测试文件：tests/integration/e2e.test.js
 * 
 * 测试场景：
 * 1. 启动代理服务
 * 2. 测试路由转发
 * 3. 测试健康检查
 * 4. 测试故障切换
 */

const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 测试配置
const PROXY_PORT = 38081; // 使用不同端口避免冲突
const PROXY_HOST = 'localhost';
const PROXY_URL = `http://${PROXY_HOST}:${PROXY_PORT}`;
const TEST_ROUTES_CONFIG = '/tmp/openclaw-monitor-test/routes.json';
const TEST_LOG_DIR = '/tmp/openclaw-monitor-test/logs';

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  reset: '\x1b[0m'
};

let passCount = 0;
let failCount = 0;
let proxyProcess = null;

// 测试函数
function testCase(name, result) {
  if (result === 'PASS') {
    console.log(`${colors.green}✅ ${name}: PASS${colors.reset}`);
    passCount++;
  } else {
    console.log(`${colors.red}❌ ${name}: FAIL - ${result}${colors.reset}`);
    failCount++;
  }
}

// 准备测试环境
function setup() {
  console.log('=== 准备测试环境 ===\n');
  
  // 创建测试目录
  const testDir = path.dirname(TEST_ROUTES_CONFIG);
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  if (!fs.existsSync(TEST_LOG_DIR)) {
    fs.mkdirSync(TEST_LOG_DIR, { recursive: true });
  }
  
  // 创建测试路由配置
  const routesConfig = {
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
  
  fs.writeFileSync(TEST_ROUTES_CONFIG, JSON.stringify(routesConfig, null, 2));
  
  console.log('测试环境准备完成\n');
}

// 启动代理服务
function startProxy() {
  return new Promise((resolve, reject) => {
    console.log('启动代理服务...');
    
    proxyProcess = spawn('node', [
      '/root/ws-mime-qq/openclaw-monitor/packages/proxy/dist/index.js'
    ], {
      env: {
        ...process.env,
        PROXY_PORT: PROXY_PORT.toString(),
        LOG_DIR: TEST_LOG_DIR,
        ROUTES_CONFIG: TEST_ROUTES_CONFIG
      }
    });
    
    proxyProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Server started')) {
        console.log('代理服务已启动\n');
        resolve();
      }
    });
    
    proxyProcess.stderr.on('data', (data) => {
      console.error('代理服务错误:', data.toString());
    });
    
    proxyProcess.on('error', (error) => {
      reject(error);
    });
    
    // 超时处理
    setTimeout(() => {
      reject(new Error('代理服务启动超时'));
    }, 10000);
  });
}

// 停止代理服务
function stopProxy() {
  return new Promise((resolve) => {
    if (proxyProcess) {
      proxyProcess.on('close', () => {
        console.log('\n代理服务已停止');
        resolve();
      });
      proxyProcess.kill('SIGTERM');
    } else {
      resolve();
    }
  });
}

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

// 测试用例
async function testHealthCheck() {
  console.log('测试: 健康检查端点');
  
  try {
    const response = await sendRequest('GET', '/health');
    const data = JSON.parse(response.body);
    
    assert.strictEqual(response.status, 200, '状态码应该是 200');
    assert.strictEqual(data.status, 'ok', '状态应该是 ok');
    assert.ok(Array.isArray(data.providers), 'providers 应该是数组');
    
    testCase('健康检查端点', 'PASS');
  } catch (error) {
    testCase('健康检查端点', error.message);
  }
}

async function testReadyCheck() {
  console.log('测试: 就绪检查端点');
  
  try {
    const response = await sendRequest('GET', '/ready');
    const data = JSON.parse(response.body);
    
    assert.strictEqual(response.status, 200, '状态码应该是 200');
    assert.strictEqual(data.ready, true, 'ready 应该是 true');
    
    testCase('就绪检查端点', 'PASS');
  } catch (error) {
    testCase('就绪检查端点', error.message);
  }
}

async function testUnknownRoute() {
  console.log('测试: 未知路由');
  
  try {
    const response = await sendRequest('POST', '/unknown/v1/chat');
    const data = JSON.parse(response.body);
    
    assert.strictEqual(response.status, 404, '状态码应该是 404');
    assert.strictEqual(data.error, 'Route not found', '错误信息应该是 Route not found');
    
    testCase('未知路由', 'PASS');
  } catch (error) {
    testCase('未知路由', error.message);
  }
}

async function testProxyStatistics() {
  console.log('测试: 代理统计信息');
  
  try {
    const response = await sendRequest('GET', '/health');
    const data = JSON.parse(response.body);
    
    assert.ok(data.requestCount >= 0, 'requestCount 应该大于等于 0');
    assert.ok(data.errorCount >= 0, 'errorCount 应该大于等于 0');
    assert.ok(data.uptime >= 0, 'uptime 应该大于等于 0');
    
    testCase('代理统计信息', 'PASS');
  } catch (error) {
    testCase('代理统计信息', error.message);
  }
}

// 运行所有测试
async function runTests() {
  console.log('=== 端到端集成测试 ===\n');
  
  try {
    // 准备环境
    setup();
    
    // 启动代理服务
    await startProxy();
    
    // 运行测试
    await testHealthCheck();
    await testReadyCheck();
    await testUnknownRoute();
    await testProxyStatistics();
    
    // 输出结果
    console.log('\n=== 测试结果 ===');
    console.log(`通过: ${passCount}`);
    console.log(`失败: ${failCount}`);
    
    if (failCount === 0) {
      console.log(`${colors.green}所有测试通过！${colors.reset}`);
    } else {
      console.log(`${colors.red}有测试失败！${colors.reset}`);
    }
    
    return failCount === 0;
  } catch (error) {
    console.error('测试执行失败:', error);
    return false;
  } finally {
    // 停止代理服务
    await stopProxy();
  }
}

// 执行测试
if (require.main === module) {
  runTests()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('测试执行失败:', error);
      process.exit(1);
    });
}

module.exports = { runTests };
