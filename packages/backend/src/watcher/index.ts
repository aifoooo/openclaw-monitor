import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import type { SessionMessage } from '../types';
import { extractSessionInfo } from '../parser';

// 配置
const OPENCLAW_DIR = process.env.OPENCLAW_DIR || '/root/.openclaw';
const AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents');
const SESSIONS_PATTERN = path.join(AGENTS_DIR, '*', 'sessions', '*.jsonl');

// 回调类型
type SessionUpdateCallback = (data: {
  sessionId: string;
  agentId: string;
  sessionFile: string;
  message: SessionMessage;
}) => void;

// 文件最后位置跟踪
const filePositions = new Map<string, number>();

// 创建监听器
export function createWatcher(onUpdate: SessionUpdateCallback) {
  const watcher = chokidar.watch(SESSIONS_PATTERN, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });
  
  watcher.on('change', (filePath: string) => {
    try {
      const { agentId, sessionId } = extractSessionInfo(filePath);
      
      // 获取上次读取位置
      const lastPosition = filePositions.get(filePath) || 0;
      
      // 读取新增内容
      const stat = fs.statSync(filePath);
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(stat.size - lastPosition);
      
      fs.readSync(fd, buffer, 0, buffer.length, lastPosition);
      fs.closeSync(fd);
      
      // 更新位置
      filePositions.set(filePath, stat.size);
      
      // 解析新增的行
      const newContent = buffer.toString('utf-8');
      const lines = newContent.trim().split('\n');
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line);
            
            // 触发回调
            onUpdate({
              sessionId,
              agentId,
              sessionFile: filePath,
              message,
            });
          } catch (e) {
            console.error(`Failed to parse line in ${filePath}:`, e);
          }
        }
      }
    } catch (e) {
      console.error(`Failed to process file change ${filePath}:`, e);
    }
  });
  
  watcher.on('add', (filePath: string) => {
    console.log(`[Watcher] New session file: ${filePath}`);
    filePositions.set(filePath, 0);
  });
  
  watcher.on('error', (error) => {
    console.error('[Watcher] Error:', error);
  });
  
  console.log(`[Watcher] Watching ${SESSIONS_PATTERN}`);
  
  return watcher;
}
