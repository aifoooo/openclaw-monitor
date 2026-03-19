// 数据类型定义

// ==================== Gateway 日志类型 ====================

export interface GatewayLogEntry {
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  subsystem?: string;
  message: string;
  runId?: string;
  toolCallId?: string;
  tool?: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  contextDiag?: ContextDiag;
}

export interface ContextDiag {
  sessionKey: string;
  messages: number;
  roleCounts: Record<string, number>;
  historyTextChars: number;
  maxMessageTextChars: number;
  systemPromptChars: number;
  promptChars: number;
  provider: string;
}

// ==================== 操作类型 ====================

export interface Operation {
  id: string;                    // toolCallId 或生成的 ID
  runId: string;
  type: 'llm' | 'tool';
  name: string;                  // provider/model 或 tool name
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'running' | 'completed' | 'failed';
  details?: any;                 // 额外信息
}

export interface LLMOperation extends Operation {
  type: 'llm';
  provider: string;
  model: string;
  durationMs?: number;
  contextSize?: {
    messages: number;
    historyTextChars: number;
    systemPromptChars: number;
    promptChars: number;
  };
}

export interface ToolOperation extends Operation {
  type: 'tool';
  toolName: string;              // exec, read, write, etc.
  toolCallId: string;
}

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
  operations?: Operation[];      // 操作列表（来自 Gateway 日志）
  statistics?: RunStatistics;    // 统计信息
  error?: string;
}

export interface StageInfo {
  stage: CacheTraceStage;
  seq: number;
  timestamp: number;
  messageCount?: number;
  note?: string;
}

export interface RunStatistics {
  totalDuration?: number;        // 总耗时（ms）
  llmCalls: number;              // LLM 调用次数
  toolCalls: number;             // 工具调用次数
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
  cost?: number;
}

// ==================== 渠道模型 ====================

export interface Channel {
  id: string;                    // 渠道标识，如 "qqbot"
  name: string;                  // 显示名称，如 "QQ Bot"
  type: string;                  // 类型：qqbot, feishu, discord
  status: 'online' | 'offline';
  accounts: Account[];
  config?: any;
}

export interface Account {
  id: string;                    // 账号 ID
  name: string;                  // 账号名称
  appId?: string;
  enabled: boolean;
  config?: any;
}

// ==================== 聊天模型 ====================

export interface Chat {
  id: string;                    // 聊天 ID
  channelId: string;             // 所属渠道
  accountId: string;             // 所属账号
  sessionKey: string;            // OpenClaw session key
  title: string;                 // 聊天标题（用户名/群名）
  lastMessageAt?: number;        // 最后消息时间戳
  messageCount: number;          // 消息数量
  runCount: number;              // Run 数量
  sessionFile?: string;          // session 文件路径
  isHidden?: boolean;            // 是否隐藏
}

// ==================== 消息模型 ====================

export interface Message {
  id: string;
  chatId?: string;
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

// ==================== Session 模型 ====================

export interface Session {
  id: string;                    // sessionId
  sessionKey: string;
  agentId: string;
  title: string;
  lastRunAt: number;
  runCount: number;
  runs: Run[];
}

// ==================== WebSocket 消息类型 ====================

export interface WSMessage {
  type: 'run:started' | 'run:completed' | 'run:updated' | 'session:updated' | 'chat:updated';
  data: Run | Session | Chat;
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
  operations: string | null;     // JSON string
  statistics: string | null;     // JSON string
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface DBOperation {
  id: number;
  run_id: string;
  type: string;
  name: string;
  start_time: number;
  end_time: number | null;
  duration: number | null;
  status: string;
  details: string | null;
  created_at: number;
}

export interface DBChannel {
  id: number;
  channel_id: string;
  name: string;
  type: string;
  status: string;
  accounts: string;              // JSON string
  config: string | null;
  created_at: number;
  updated_at: number;
}

export interface DBChat {
  id: number;
  chat_id: string;
  channel_id: string;
  account_id: string;
  session_key: string;
  title: string;
  last_message_at: number | null;
  message_count: number;
  run_count: number;
  session_file: string | null;
  is_hidden: number;
  created_at: number;
  updated_at: number;
}

// ==================== 配置类型 ====================

export interface MonitorConfig {
  openclawDir: string;           // OpenClaw 配置目录
  cacheTracePath: string;        // Cache Trace 文件路径
  gatewayLogPath: string;        // Gateway 日志路径（支持通配符）
  dbPath: string;                // SQLite 数据库路径
  port: number;                  // 后端端口
  wsPort: number;                // WebSocket 端口
  recentLimit: number;           // 增量初始化时解析的最近条目数
  cleanupInterval: number;       // 清理间隔（ms）
  cacheTracesDaysToKeep: number; // 保留多少天的 Cache Trace
  runsDaysToKeep: number;        // 保留多少天的 Run
}
