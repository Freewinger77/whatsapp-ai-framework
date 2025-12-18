/**
 * Environment bindings for Cloudflare Worker
 * These are configured in wrangler.toml and accessed via env
 */

// Cloudflare AI binding type (includes AutoRAG)
interface AIBinding {
  autorag(name: string): {
    search(options: { query: string; rewrite?: boolean }): Promise<AutoRAGSearchResult>;
    aiSearch(options: { query: string; rewrite?: boolean }): Promise<AutoRAGAISearchResult>;
  };
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  // KV Namespace for conversation memory
  CHAT_MEMORY: KVNamespace;

  // D1 Database for agent states
  DB: D1Database;

  // R2 Bucket for content storage
  CONTENT_BUCKET: R2Bucket;

  // AI binding for AutoRAG and Workers AI
  AI: AIBinding;

  // Environment variables (from wrangler.toml [vars])
  BOT_NAME: string;
  SUPPORTED_TOPICS: string;
  DEFAULT_LANGUAGE: string;
  AI_PAUSE_DEFAULT_MINUTES: string;
  LLM_PROVIDER: 'openai' | 'gemini';
  ENVIRONMENT?: string;

  // Secrets (set via wrangler secret put)
  EVOLUTION_API_URL: string;
  EVOLUTION_API_KEY: string;
  EVOLUTION_INSTANCE_NAME: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_AGENT_CHAT_ID?: string;
  DISCORD_WEBHOOK_URL?: string;
  AUTORAG_NAME: string;
}

// AutoRAG search result types
export interface AutoRAGSearchResult {
  matches: Array<{
    id: string;
    score: number;
    metadata: {
      filename?: string;
      source?: string;
      [key: string]: unknown;
    };
    content: string;
  }>;
}

export interface AutoRAGAISearchResult {
  response: string;
  matches: AutoRAGSearchResult['matches'];
}

// Evolution API types
export interface EvolutionWebhookPayload {
  event: string;
  instance: string;
  data: {
    key: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
    };
    pushName?: string;
    message?: {
      conversation?: string;
      extendedTextMessage?: {
        text: string;
      };
      imageMessage?: {
        caption?: string;
      };
    };
    messageType?: string;
    messageTimestamp?: number;
  };
}

export interface EvolutionSendMessagePayload {
  number: string;
  text: string;
}

// Conversation memory types
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ConversationHistory {
  messages: ConversationMessage[];
  lastUpdated: number;
}

// D1 Database types
export interface ChatState {
  chat_id: string;
  ai_enabled: boolean;
  paused_until: string | null;
  assigned_agent: string | null;
  created_at: string;
  updated_at: string;
}

export interface Escalation {
  id: number;
  chat_id: string;
  user_question: string;
  reason: string;
  agent_id: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface Agent {
  id: string;
  name: string;
  notification_channel: string | null;
  is_active: boolean;
}

// LLM Provider types
export interface LLMResponse {
  content: string;
  confidence: number;
  model: string;
}

export interface LLMProvider {
  chat(options: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }): Promise<LLMResponse>;
}

// Notification types
export interface AgentNotification {
  chatId: string;
  userQuestion: string;
  conversationHistory: ConversationMessage[];
  reason: string;
  timestamp: number;
}

// API Response types
export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
