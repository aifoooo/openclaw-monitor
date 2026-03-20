<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <h1>🦐 OpenClaw Monitor</h1>
        <p>请输入访问 Token</p>
      </div>
      
      <div class="login-form">
        <div class="form-group">
          <label for="token">API Token</label>
          <input 
            id="token"
            v-model="token"
            type="password"
            placeholder="输入您的 Token"
            @keyup.enter="handleLogin"
            :disabled="loading"
          />
        </div>
        
        <div v-if="error" class="error-message">
          {{ error }}
        </div>
        
        <button 
          class="login-button" 
          @click="handleLogin"
          :disabled="!token || loading"
        >
          <span v-if="loading" class="loading-spinner">⟳</span>
          {{ loading ? '验证中...' : '登录' }}
        </button>
      </div>
      
      <div class="login-footer">
        <p>Token 可通过 URL 参数传递：</p>
        <code>http://43.128.29.188:5173?token=YOUR_TOKEN</code>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { setToken, validateToken } from '../services/api';

const router = useRouter();
const token = ref('');
const loading = ref(false);
const error = ref('');

async function handleLogin() {
  if (!token.value.trim()) {
    error.value = '请输入 Token';
    return;
  }
  
  loading.value = true;
  error.value = '';
  
  try {
    const isValid = await validateToken(token.value.trim());
    
    if (isValid) {
      setToken(token.value.trim());
      router.push('/');
    } else {
      error.value = 'Token 无效，请检查后重试';
    }
  } catch (e) {
    error.value = '验证失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-container {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, oklch(96% 0.01 250) 0%, oklch(92% 0.02 250) 100%);
}

.login-card {
  background: white;
  border-radius: 12px;
  padding: 40px;
  width: 400px;
  max-width: 90%;
  box-shadow: 0 4px 24px oklch(70% 0.02 250 / 0.1);
}

.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.login-header h1 {
  font-size: 24px;
  color: oklch(25% 0.02 250);
  margin-bottom: 8px;
}

.login-header p {
  font-size: 14px;
  color: oklch(50% 0.01 250);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  font-size: 13px;
  font-weight: 600;
  color: oklch(35% 0.02 250);
}

.form-group input {
  padding: 12px;
  border: 1px solid oklch(85% 0.01 250);
  border-radius: 8px;
  font-size: 14px;
  transition: border-color 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: oklch(55% 0.18 250);
}

.form-group input:disabled {
  background: oklch(96% 0.01 250);
  cursor: not-allowed;
}

.error-message {
  color: oklch(55% 0.2 25);
  font-size: 13px;
  padding: 8px 12px;
  background: oklch(95% 0.03 25);
  border-radius: 6px;
}

.login-button {
  padding: 12px;
  background: oklch(55% 0.18 250);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.login-button:hover:not(:disabled) {
  background: oklch(50% 0.18 250);
}

.login-button:disabled {
  background: oklch(70% 0.01 250);
  cursor: not-allowed;
}

.loading-spinner {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.login-footer {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid oklch(92% 0.01 250);
  text-align: center;
}

.login-footer p {
  font-size: 12px;
  color: oklch(50% 0.01 250);
  margin-bottom: 8px;
}

.login-footer code {
  display: block;
  font-size: 11px;
  color: oklch(35% 0.02 250);
  background: oklch(96% 0.01 250);
  padding: 8px;
  border-radius: 4px;
  word-break: break-all;
}
</style>
