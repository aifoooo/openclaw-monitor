import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 远程后端地址（开发时使用）
const REMOTE_BACKEND = process.env.VITE_API_BASE || 'http://43.128.29.188:3000';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',  // 允许外部访问
    port: 5173,
    proxy: {
      '/api': {
        target: REMOTE_BACKEND,
        changeOrigin: true,
      },
    },
  },
});