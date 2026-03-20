import { createRouter, createWebHistory } from 'vue-router';
import { getCurrentToken } from '../services/api';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/Login.vue'),
    },
    {
      path: '/',
      name: 'home',
      component: () => import('../views/Home.vue'),
      meta: { requiresAuth: true },
    },
  ],
});

// 路由守卫：检查认证
router.beforeEach((to, from, next) => {
  const token = getCurrentToken();
  
  if (to.meta.requiresAuth && !token) {
    // 需要认证但没有 token，跳转到登录页
    next('/login');
  } else if (to.name === 'login' && token) {
    // 已登录，跳转到首页
    next('/');
  } else {
    next();
  }
});

export default router;