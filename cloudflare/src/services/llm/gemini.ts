/**
 * Google Gemini LLM Provider
 * Integrates with Google AI Studio / Vertex AI for chat completions
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { LLMProvider } from '../../types';

const DEFAULT_MODEL = 'gemini-1.5-flash';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.7;

export function createGeminiProvider(
  apiKey: string,
  model?: string
): LLMProvider {
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelId = model || DEFAULT_MODEL;

  return {
    async chat(options) {
      const geminiModel = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: {
          temperature: options.temperature ?? DEFAULT_TEMPERATURE,
          maxOutputTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        },
      });

      // Convert messages to Gemini format
      // Gemini expects a different structure: system instruction + history + current message
      const systemMessage = options.messages.find(m => m.role === 'system');
      const chatMessages = options.messages.filter(m => m.role !== 'system');

      // Start chat with system instruction
      const chat = geminiModel.startChat({
        history: chatMessages.slice(0, -1).map(msg => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        })),
        ...(systemMessage?.content ? { systemInstruction: systemMessage.content } : {}),
      });

      // Get the last user message
      const lastMessage = chatMessages[chatMessages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user') {
        throw new Error('Last message must be from user');
      }

      // Send message and get response
      const result = await chat.sendMessage(lastMessage.content);
      const response = result.response;
      const text = response.text();

      if (!text) {
        throw new Error('No response content from Gemini');
      }

      // Calculate confidence based on safety ratings and finish reason
      let confidence = 0.8;
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason === 'STOP') {
        confidence = 0.9;
      } else if (finishReason === 'MAX_TOKENS') {
        confidence = 0.6;
      } else if (finishReason === 'SAFETY') {
        confidence = 0.3;
      }

      return {
        content: text,
        confidence,
        model: modelId,
      };
    },
  };
}
