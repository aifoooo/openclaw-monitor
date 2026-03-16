import fs from 'fs';
import path from 'path';

export interface RouteConfig {
  path: string;
  target: string;
  stripPath: boolean;
}

export interface RoutesConfig {
  routes: Record<string, RouteConfig>;
}

const ROUTES_CONFIG_PATH = process.env.ROUTES_CONFIG || '/etc/openclaw-monitor/routes.json';

let routesConfig: RoutesConfig | null = null;
let lastLoadTime = 0;
const CONFIG_RELOAD_INTERVAL = 60000; // 1 分钟重新加载一次配置

export function loadRoutes(): RoutesConfig {
  const now = Date.now();
  
  // 缓存配置，避免频繁读取文件
  if (routesConfig && now - lastLoadTime < CONFIG_RELOAD_INTERVAL) {
    return routesConfig;
  }
  
  try {
    if (!fs.existsSync(ROUTES_CONFIG_PATH)) {
      console.warn(`[Router] Routes config not found: ${ROUTES_CONFIG_PATH}`);
      return { routes: {} };
    }
    
    const content = fs.readFileSync(ROUTES_CONFIG_PATH, 'utf-8');
    routesConfig = JSON.parse(content);
    lastLoadTime = now;
    
    console.log(`[Router] Loaded ${Object.keys(routesConfig!.routes).length} routes`);
    return routesConfig!;
  } catch (error) {
    console.error('[Router] Failed to load routes config:', error);
    return routesConfig || { routes: {} };
  }
}

export interface MatchedRoute {
  name: string;
  config: RouteConfig;
  targetPath: string;
}

export function matchRoute(requestPath: string, routes: RoutesConfig): MatchedRoute | null {
  // 按路径长度降序排序，确保最长路径优先匹配
  const sortedRoutes = Object.entries(routes.routes)
    .sort((a, b) => b[1].path.length - a[1].path.length);
  
  for (const [name, config] of sortedRoutes) {
    if (requestPath.startsWith(config.path)) {
      let targetPath = requestPath;
      
      if (config.stripPath) {
        // 移除路径前缀
        targetPath = requestPath.slice(config.path.length);
        
        // 确保以 / 开头
        if (!targetPath.startsWith('/')) {
          targetPath = '/' + targetPath;
        }
      }
      
      return {
        name,
        config,
        targetPath,
      };
    }
  }
  
  return null;
}

export function getAllProviders(routes: RoutesConfig): string[] {
  return Object.keys(routes.routes);
}

export function getProviderTarget(provider: string, routes: RoutesConfig): string | null {
  return routes.routes[provider]?.target || null;
}
