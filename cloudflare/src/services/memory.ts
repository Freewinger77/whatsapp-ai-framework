/**
 * Conversation Memory Service
 * Uses Cloudflare KV to store conversation history per chat
 */

import type { Env, ConversationMessage, ConversationHistory } from '../types';

const MAX_MESSAGES = 10; // Keep last 10 messages for context
const TTL_SECONDS = 86400; // 24 hours
const KEY_PREFIX = 'chat:';

/**
 * Get conversation history for a chat
 */
export async function getConversationHistory(
  env: Env,
  chatId: string
): Promise<ConversationHistory> {
  const key = `${KEY_PREFIX}${chatId}`;

  try {
    const stored = await env.CHAT_MEMORY.get(key, 'json');

    if (!stored) {
      return {
        messages: [],
        lastUpdated: 0,
      };
    }

    return stored as ConversationHistory;
  } catch (error) {
    console.error('[Memory] Error getting conversation:', error);
    return {
      messages: [],
      lastUpdated: 0,
    };
  }
}

/**
 * Add messages to conversation history
 */
export async function addToConversation(
  env: Env,
  chatId: string,
  newMessages: ConversationMessage[]
): Promise<void> {
  const key = `${KEY_PREFIX}${chatId}`;

  try {
    // Get existing history
    const history = await getConversationHistory(env, chatId);

    // Add new messages
    const updatedMessages = [...history.messages, ...newMessages];

    // Keep only the last MAX_MESSAGES
    const trimmedMessages = updatedMessages.slice(-MAX_MESSAGES);

    const updatedHistory: ConversationHistory = {
      messages: trimmedMessages,
      lastUpdated: Date.now(),
    };

    // Store with TTL
    await env.CHAT_MEMORY.put(key, JSON.stringify(updatedHistory), {
      expirationTtl: TTL_SECONDS,
    });

    console.log(`[Memory] Updated conversation for ${chatId}, ${trimmedMessages.length} messages`);
  } catch (error) {
    console.error('[Memory] Error updating conversation:', error);
    // Don't throw - memory is nice to have but not critical
  }
}

/**
 * Clear conversation history for a chat
 */
export async function clearConversation(
  env: Env,
  chatId: string
): Promise<void> {
  const key = `${KEY_PREFIX}${chatId}`;

  try {
    await env.CHAT_MEMORY.delete(key);
    console.log(`[Memory] Cleared conversation for ${chatId}`);
  } catch (error) {
    console.error('[Memory] Error clearing conversation:', error);
  }
}

/**
 * Format conversation history for display or logging
 */
export function formatConversationHistory(
  history: ConversationHistory
): string {
  if (history.messages.length === 0) {
    return 'No previous conversation.';
  }

  return history.messages
    .map((msg) => {
      const time = new Date(msg.timestamp).toLocaleTimeString();
      const role = msg.role === 'user' ? '👤 User' : '🤖 Bot';
      return `[${time}] ${role}: ${msg.content}`;
    })
    .join('\n');
}
