/**
 * 渠道管理模块
 * 
 * 从 OpenClaw 配置文件解析渠道信息
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Channel, Account } from '../types';

/**
 * 解析 OpenClaw 配置文件
 */
export function parseOpenClawConfig(openclawDir: string): {
  channels: Channel[];
  models: any;
  diagnostics: any;
} {
  const configPath = path.join(openclawDir, 'openclaw.json');
  
  if (!fs.existsSync(configPath)) {
    console.warn(`[Channel] Config file not found: ${configPath}`);
    return { channels: [], models: {}, diagnostics: {} };
  }
  
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    
    const channels = parseChannels(config.channels || {});
    const models = config.models || {};
    const diagnostics = config.diagnostics || {};
    
    console.log(`[Channel] Parsed ${channels.length} channels from config`);
    
    return { channels, models, diagnostics };
  } catch (e) {
    console.error('[Channel] Failed to parse config:', e);
    return { channels: [], models: {}, diagnostics: {} };
  }
}

/**
 * 解析渠道配置
 */
function parseChannels(channelsConfig: any): Channel[] {
  const channels: Channel[] = [];
  
  for (const [channelId, channelConfig] of Object.entries(channelsConfig)) {
    const config = channelConfig as any;
    
    if (!config.enabled) {
      continue;
    }
    
    const channel: Channel = {
      id: channelId,
      name: getChannelName(channelId),
      type: getChannelType(channelId),
      status: 'online', // 假设启用的渠道都是在线的
      accounts: parseAccounts(config.accounts || {}),
      config: config,
    };
    
    channels.push(channel);
  }
  
  return channels;
}

/**
 * 解析账号配置
 */
function parseAccounts(accountsConfig: any): Account[] {
  const accounts: Account[] = [];
  
  for (const [accountId, accountConfig] of Object.entries(accountsConfig)) {
    const config = accountConfig as any;
    
    const account: Account = {
      id: accountId,
      name: accountId,
      appId: config.appId,
      enabled: config.enabled !== false,
      config: config,
    };
    
    accounts.push(account);
  }
  
  return accounts;
}

/**
 * 获取渠道名称
 */
function getChannelName(channelId: string): string {
  const names: Record<string, string> = {
    'qqbot': 'QQ Bot',
    'feishu': '飞书',
    'discord': 'Discord',
    'telegram': 'Telegram',
    'slack': 'Slack',
    'wechat': '微信',
  };
  
  return names[channelId] || channelId;
}

/**
 * 获取渠道类型
 */
function getChannelType(channelId: string): string {
  return channelId; // 直接使用 channelId 作为类型
}

/**
 * 获取渠道状态（基于最近活动）
 */
export function getChannelStatus(channelId: string, recentRuns: any[]): 'online' | 'offline' {
  // 如果最近有活动，则认为在线
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  const hasRecentActivity = recentRuns.some(run => 
    run.sessionKey?.includes(channelId) && run.startedAt > fiveMinutesAgo
  );
  
  return hasRecentActivity ? 'online' : 'offline';
}

/**
 * 获取渠道的 session 目录
 */
export function getChannelSessionDir(openclawDir: string, channelId: string): string {
  // 渠道特定的 session 目录
  const channelDir = path.join(openclawDir, channelId, 'sessions');
  if (fs.existsSync(channelDir)) {
    return channelDir;
  }
  
  // 全局 session 目录
  const globalDir = path.join(openclawDir, 'sessions');
  if (fs.existsSync(globalDir)) {
    return globalDir;
  }
  
  return channelDir;
}

/**
 * 监听渠道状态变化
 */
export function watchChannelStatus(
  openclawDir: string,
  callback: (channels: Channel[]) => void
): () => void {
  const configPath = path.join(openclawDir, 'openclaw.json');
  
  if (!fs.existsSync(configPath)) {
    return () => {};
  }
  
  let lastMtime = fs.statSync(configPath).mtime.getTime();
  
  const interval = setInterval(() => {
    try {
      const currentMtime = fs.statSync(configPath).mtime.getTime();
      if (currentMtime > lastMtime) {
        lastMtime = currentMtime;
        const { channels } = parseOpenClawConfig(openclawDir);
        callback(channels);
      }
    } catch (e) {
      // 忽略错误
    }
  }, 5000);
  
  return () => clearInterval(interval);
}
