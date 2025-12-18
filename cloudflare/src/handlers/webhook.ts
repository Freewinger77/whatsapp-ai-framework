/**
 * WhatsApp Webhook Handler
 * Processes incoming messages from Evolution API
 */

import type { Context } from 'hono';
import type { Env, EvolutionWebhookPayload, APIResponse } from '../types';
import { isAIPaused } from '../services/agentState';
import { getConversationHistory, addToConversation } from '../services/memory';
import { searchContent } from '../services/autorag';
import { generateResponse } from '../services/llm';
import { sendWhatsAppMessage } from '../services/evolution';
import { notifyAgent } from '../services/notify';
import { detectLanguage } from '../utils/language';
import { assessConfidence } from '../utils/confidence';
import { buildSystemPrompt, buildFallbackResponse } from '../utils/prompts';

export const webhookHandler = async (
  c: Context<{ Bindings: Env }>
): Promise<Response> => {
  try {
    // Parse webhook payload
    const payload = await c.req.json<EvolutionWebhookPayload>();

    // Only process incoming messages (not sent by us)
    if (payload.event !== 'messages.upsert' || payload.data.key.fromMe) {
      return c.json<APIResponse>({ success: true, data: { skipped: true } });
    }

    // Extract message content
    const messageContent = extractMessageContent(payload);
    if (!messageContent) {
      return c.json<APIResponse>({ success: true, data: { skipped: true, reason: 'no_text_content' } });
    }

    const chatId = payload.data.key.remoteJid;
    const userName = payload.data.pushName || 'User';

    console.log(`[Webhook] Message from ${userName} (${chatId}): ${messageContent.substring(0, 100)}...`);

    // Check if AI is paused for this chat
    const paused = await isAIPaused(c.env, chatId);
    if (paused) {
      console.log(`[Webhook] AI paused for chat ${chatId}, skipping`);
      return c.json<APIResponse>({
        success: true,
        data: { skipped: true, reason: 'ai_paused' }
      });
    }

    // Get conversation history for context
    const history = await getConversationHistory(c.env, chatId);

    // Detect language from message
    const language = detectLanguage(messageContent);

    // Search for relevant content using AutoRAG
    const searchResults = await searchContent(c.env, messageContent);

    // Assess confidence based on search results
    const confidence = assessConfidence(searchResults);

    let responseText: string;

    if (confidence.isConfident) {
      // Generate AI response with context
      const systemPrompt = buildSystemPrompt({
        botName: c.env.BOT_NAME,
        supportedTopics: c.env.SUPPORTED_TOPICS,
        language,
        context: searchResults.matches.map(m => m.content).join('\n\n'),
      });

      const llmResponse = await generateResponse(c.env, {
        systemPrompt,
        userMessage: messageContent,
        conversationHistory: history.messages,
      });

      responseText = llmResponse.content;
    } else {
      // Low confidence - offer human handoff
      responseText = buildFallbackResponse({
        language,
        supportedTopics: c.env.SUPPORTED_TOPICS,
      });

      // Notify human agent about potential escalation
      await notifyAgent(c.env, {
        chatId,
        userQuestion: messageContent,
        conversationHistory: history.messages,
        reason: confidence.reason,
        timestamp: Date.now(),
      });
    }

    // Send response via Evolution API
    await sendWhatsAppMessage(c.env, {
      number: chatId,
      text: responseText,
    });

    // Update conversation history
    await addToConversation(c.env, chatId, [
      { role: 'user', content: messageContent, timestamp: Date.now() },
      { role: 'assistant', content: responseText, timestamp: Date.now() },
    ]);

    return c.json<APIResponse>({
      success: true,
      data: {
        chatId,
        language,
        confidence: confidence.score,
        responded: true,
      }
    });

  } catch (error) {
    console.error('[Webhook] Error processing message:', error);
    return c.json<APIResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
};

/**
 * Extract text content from various WhatsApp message types
 */
function extractMessageContent(payload: EvolutionWebhookPayload): string | null {
  const message = payload.data.message;
  if (!message) return null;

  // Regular text message
  if (message.conversation) {
    return message.conversation;
  }

  // Extended text (quoted replies, links, etc.)
  if (message.extendedTextMessage?.text) {
    return message.extendedTextMessage.text;
  }

  // Image with caption
  if (message.imageMessage?.caption) {
    return message.imageMessage.caption;
  }

  // TODO: Add support for audio transcription, document text extraction

  return null;
}
