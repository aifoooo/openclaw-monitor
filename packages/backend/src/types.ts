// 数据类型定义

export interface Channel {
  id: string;
  name: string;
  type: string;
  status: 'online' | 'offline';
  config?: any;
}

export interface Chat {
  id: string;
  channelId: string;
  sessionKey: string;
  title: string;
  lastMessageAt: number;
  messageCount: number;
  sessionFile: string;
}

export interface Message {
  id: string;
  chatId: string;
  role: 'user' | 'assistant' | 'toolResult';
  content: Content[];
  timestamp: number;
  operations?: Operation[];
  usage?: Usage;
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

export interface Operation {
  id: string;
  messageId: string;
  type: 'tool' | 'llm';
  name: string;
  input: any;
  output: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
}

// Session 文件中的原始格式

export interface SessionMessage {
  type: 'session' | 'message';
  id?: string;
  parentId?: string;
  timestamp?: string;
  message?: {
    role: 'user' | 'assistant' | 'toolResult';
    content: any[];
    toolCallId?: string;
    toolName?: string;
    api?: string;
    provider?: string;
    model?: string;
    usage?: Usage;
    stopReason?: string;
  };
}

// 代理日志格式

export interface ProxyLogEntry {
  timestamp: number;
  durationMs: number;
  isStreaming: boolean;
  request: {
    method: string;
    path: string;
    headers: any;
    body: any;
  };
  response: {
    statusCode: number;
    headers: any;
    body: any;
  };
}
