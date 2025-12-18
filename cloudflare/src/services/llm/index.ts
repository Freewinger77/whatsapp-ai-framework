/**
 * LLM Provider Factory
 * Abstracts LLM calls to support multiple providers (OpenAI, Gemini)
 */

import type { Env, ConversationMessage, LLMResponse } from '../../types';
import { createOpenAIProvider } from './openai';
import { createGeminiProvider } from './gemini';

export interface GenerateOptions {
  systemPrompt: string;
  userMessage: string;
  conversationHistory: ConversationMessage[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * Generate a response using the configured LLM provider
 */
export async function generateResponse(
  env: Env,
  options: GenerateOptions
): Promise<LLMResponse> {
  const provider = env.LLM_PROVIDER || 'openai';

  // Build messages array with conversation history
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: options.systemPrompt },
  ];

  // Add conversation history (last 10 messages for context)
  const recentHistory = options.conversationHistory.slice(-10);
  for (const msg of recentHistory) {
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  }

  // Add current user message
  messages.push({ role: 'user', content: options.userMessage });

  // Route to appropriate provider
  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    const gemini = createGeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL);
    return gemini.chat({
      messages,
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxTokens !== undefined && { maxTokens: options.maxTokens }),
    });
  }

  // Default to OpenAI
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  const openai = createOpenAIProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL);
  return openai.chat({
    messages,
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.maxTokens !== undefined && { maxTokens: options.maxTokens }),
  });
}
