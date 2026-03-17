// 数据类型定义

// ==================== Cache Trace 类型 ====================

export interface CacheTraceEntry {
  runId: string;
  sessionId: string;
  sessionKey: string;
  provider: string;
  modelId: string;
  modelApi?: string;
  workspaceDir?: string;
  seq: number;
  stage: CacheTraceStage;
  ts: string;
  messageCount?: number;
  messageRoles?: string[];
  messages?: CacheTraceMessage[];
  messageFingerprints?: string[];
  messagesDigest?: string;
  system?: string;
  systemDigest?: string;
  prompt?: string;
  note?: string;
  options?: any;
  model?: any;
}

export type CacheTraceStage = 
  | 'session:loaded'
  | 'session:sanitized'
  | 'session:limited'
  | 'session:after'
  | 'stream:context'
  | 'prompt:before'
  | 'prompt:images';

export interface CacheTraceMessage {
  role: 'user' | 'assistant' | 'toolResult';
  content: CacheTraceContent[];
  toolCallId?: string;
  toolName?: string;
  timestamp?: number;
  api?: string;
  provider?: string;
  model?: string;
  usage?: Usage;
  stopReason?: string;
  details?: any;
  isError?: boolean;
}

export interface CacheTraceContent {
  type: 'text' | 'thinking' | 'toolCall' | 'image';
  text?: string;
  thinking?: string;
  thinkingSignature?: string;
  toolCall?: ToolCall;
  image?: { url: string };
}

// ==================== 领域模型 ====================

export interface Run {
  id: string;                    // runId
  sessionId: string;
  sessionKey: string;
  provider: string;
  modelId: string;
  workspaceDir?: string;
  startedAt: number;             // 第一次 stream:context 的时间
  completedAt?: number;          // session:after 的时间
  status: 'running' | 'completed' | 'failed';
  inputMessages?: CacheTraceMessage[];   // stream:context 时的消息
  outputMessages?: CacheTraceMessage[];  // session:after 时的消息
  messageCount: number;
  stages: StageInfo[];
  error?: string;
}

export interface StageInfo {
  stage: CacheTraceStage;
  seq: number;
  timestamp: number;
  messageCount?: number;
  note?: string;
}

// ==================== 前端展示类型 ====================

export interface Channel {
  id: string;
  name: string;
  type: string;
  status: 'online' | 'offline';
  config?: any;
}

export interface Session {
  id: string;                    // sessionId
  sessionKey: string;
  agentId: string;
  title: string;
  lastRunAt: number;
  runCount: number;
  runs: Run[];
}

export interface Message {
  id: string;
  runId: string;
  role: 'user' | 'assistant' | 'toolResult';
  content: Content[];
  timestamp: number;
  toolCallId?: string;
  toolName?: string;
  usage?: Usage;
  stopReason?: string;
  isError?: boolean;
}

export interface Content {
  type: 'text' | 'thinking' | 'toolCall' | 'image';
  text?: string;
  thinking?: string;
  toolCall?: ToolCall;
  image?: { url: string };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

// ==================== WebSocket 消息类型 ====================

export interface WSMessage {
  type: 'run:started' | 'run:completed' | 'run:updated' | 'session:updated';
  data: Run | Session;
  seq: number;
}

// ==================== 数据库类型 ====================

export interface DBCacheTrace {
  id?: number;
  runId: string;
  sessionId: string;
  sessionKey: string;
  provider: string;
  modelId: string;
  stage: string;
  seq: number;
  timestamp: number;
  raw: string;                   // JSON string
  createdAt: number;
}

export interface DBRun {
  id: number;
  run_id: string;
  session_id: string;
  session_key: string;
  provider: string;
  model_id: string;
  workspace_dir: string | null;
  started_at: number;
  completed_at: number | null;
  status: string;
  input_messages: string | null;
  output_messages: string | null;
  message_count: number;
  stages: string;
  error: string | null;
  created_at: number;
  updated_at: number;
}

// ==================== 配置类型 ====================

export interface MonitorConfig {
  openclawDir: string;           // OpenClaw 配置目录
  cacheTracePath: string;        // Cache Trace 文件路径
  dbPath: string;                // SQLite 数据库路径
  port: number;                  // 后端端口
  wsPort: number;                // WebSocket 端口
}
