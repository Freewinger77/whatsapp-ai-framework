/**
 * Prompt Templates
 * System prompts and response templates for the chatbot
 */

import type { SupportedLanguage } from './language';
import { getLanguageInstruction } from './language';

export interface SystemPromptOptions {
  botName: string;
  supportedTopics: string;
  language: SupportedLanguage;
  context: string;
}

export interface FallbackOptions {
  language: SupportedLanguage;
  supportedTopics: string;
}

/**
 * Build the system prompt for the LLM
 */
export function buildSystemPrompt(options: SystemPromptOptions): string {
  const languageInstruction = getLanguageInstruction(options.language);

  return `You are ${options.botName}, a helpful AI assistant.

## Your Role
You answer questions based ONLY on the provided context. You are knowledgeable about: ${options.supportedTopics}.

## Rules
1. ONLY use information from the Context provided below to answer questions
2. If the context doesn't contain the answer, politely say you don't have that information
3. Never make up information or use knowledge outside the provided context
4. Keep responses concise and helpful (under 300 words)
5. Be friendly and professional
6. ${languageInstruction}

## Context (Use this to answer the question)
${options.context || 'No relevant context available.'}

## Response Guidelines
- Answer directly and helpfully
- If relevant, mention where the information comes from
- If you can't answer from the context, offer to connect them with a human agent
- Use appropriate formatting for WhatsApp (simple text, avoid complex markdown)`;
}

/**
 * Build fallback response when confidence is low
 */
export function buildFallbackResponse(options: FallbackOptions): string {
  const { language, supportedTopics } = options;

  const responses: Record<SupportedLanguage, string> = {
    en: `I apologize, but I couldn't find specific information to answer your question in my knowledge base.

I can help you with topics like: ${supportedTopics}.

Would you like to speak with a human agent? They'll be happy to assist you further.`,

    ms: `Maaf, saya tidak dapat mencari maklumat khusus untuk menjawab soalan anda dalam pangkalan pengetahuan saya.

Saya boleh membantu anda dengan topik seperti: ${supportedTopics}.

Adakah anda ingin bercakap dengan ejen manusia? Mereka dengan senang hati akan membantu anda.`,

    zh: `抱歉，我无法在我的知识库中找到具体信息来回答您的问题。

我可以帮助您解答关于以下主题的问题：${supportedTopics}。

您是否希望与人工客服交谈？他们很乐意为您提供进一步的帮助。`,
  };

  return responses[language] || responses.en;
}

/**
 * Build a welcome message for new conversations
 */
export function buildWelcomeMessage(
  botName: string,
  language: SupportedLanguage
): string {
  const messages: Record<SupportedLanguage, string> = {
    en: `Hi! I'm ${botName}, your AI assistant. 👋

I'm here to help you with your questions. How can I assist you today?`,

    ms: `Hai! Saya ${botName}, pembantu AI anda. 👋

Saya di sini untuk membantu anda dengan soalan anda. Bagaimana saya boleh membantu anda hari ini?`,

    zh: `您好！我是${botName}，您的AI助手。👋

我在这里帮助您解答问题。今天有什么可以帮助您的吗？`,
  };

  return messages[language] || messages.en;
}

/**
 * Build message when AI is taking over from human agent
 */
export function buildAIResumeMessage(language: SupportedLanguage): string {
  const messages: Record<SupportedLanguage, string> = {
    en: `Thank you for your patience! I'm back to assist you. Is there anything else I can help you with?`,

    ms: `Terima kasih atas kesabaran anda! Saya kembali untuk membantu anda. Ada apa-apa lagi yang saya boleh bantu?`,

    zh: `感谢您的耐心等待！我回来继续为您服务。还有什么我可以帮助您的吗？`,
  };

  return messages[language] || messages.en;
}
