/**
 * OpenAI LLM Provider
 * Integrates with OpenAI API for chat completions
 */

import OpenAI from 'openai';
import type { LLMProvider } from '../../types';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.7;

export function createOpenAIProvider(
  apiKey: string,
  model?: string
): LLMProvider {
  const client = new OpenAI({ apiKey });
  const modelId = model || DEFAULT_MODEL;

  return {
    async chat(options) {
      const response = await client.chat.completions.create({
        model: modelId,
        messages: options.messages,
        temperature: options.temperature ?? DEFAULT_TEMPERATURE,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      });

      const choice = response.choices[0];
      if (!choice?.message?.content) {
        throw new Error('No response content from OpenAI');
      }

      // Calculate confidence based on finish reason and token usage
      let confidence = 0.8; // Base confidence
      if (choice.finish_reason === 'stop') {
        confidence = 0.9;
      } else if (choice.finish_reason === 'length') {
        confidence = 0.6; // Response was cut off
      }

      return {
        content: choice.message.content,
        confidence,
        model: modelId,
      };
    },
  };
}
