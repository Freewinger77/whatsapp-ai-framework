/**
 * Agent State Service
 * Uses Cloudflare D1 to manage AI pause states and escalations
 */

import type { Env, ChatState } from '../types';

/**
 * Check if AI is paused for a specific chat
 */
export async function isAIPaused(
  env: Env,
  chatId: string
): Promise<boolean> {
  try {
    const result = await env.DB.prepare(
      `SELECT ai_enabled, paused_until FROM chat_states WHERE chat_id = ?`
    )
      .bind(chatId)
      .first<{ ai_enabled: number; paused_until: string | null }>();

    if (!result) {
      return false; // No record = AI is enabled
    }

    // Check if explicitly disabled
    if (!result.ai_enabled) {
      return true;
    }

    // Check if paused until a specific time
    if (result.paused_until) {
      const pausedUntil = new Date(result.paused_until);
      if (pausedUntil > new Date()) {
        return true; // Still paused
      }

      // Pause expired, re-enable AI
      await resumeAI(env, chatId);
    }

    return false;
  } catch (error) {
    console.error('[AgentState] Error checking pause status:', error);
    return false; // Default to AI enabled on error
  }
}

/**
 * Pause AI for a specific chat
 */
export async function pauseAI(
  env: Env,
  chatId: string,
  pausedUntil: Date,
  agentId?: string
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO chat_states (chat_id, ai_enabled, paused_until, assigned_agent, updated_at)
       VALUES (?, 0, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(chat_id) DO UPDATE SET
         ai_enabled = 0,
         paused_until = excluded.paused_until,
         assigned_agent = excluded.assigned_agent,
         updated_at = CURRENT_TIMESTAMP`
    )
      .bind(chatId, pausedUntil.toISOString(), agentId || null)
      .run();

    console.log(`[AgentState] AI paused for ${chatId} until ${pausedUntil.toISOString()}`);
  } catch (error) {
    console.error('[AgentState] Error pausing AI:', error);
    throw error;
  }
}

/**
 * Resume AI for a specific chat
 */
export async function resumeAI(
  env: Env,
  chatId: string
): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE chat_states
       SET ai_enabled = 1, paused_until = NULL, assigned_agent = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE chat_id = ?`
    )
      .bind(chatId)
      .run();

    console.log(`[AgentState] AI resumed for ${chatId}`);
  } catch (error) {
    console.error('[AgentState] Error resuming AI:', error);
    throw error;
  }
}

/**
 * Get agent state for a specific chat
 */
export async function getAgentState(
  env: Env,
  chatId: string
): Promise<ChatState | null> {
  try {
    const result = await env.DB.prepare(
      `SELECT * FROM chat_states WHERE chat_id = ?`
    )
      .bind(chatId)
      .first<ChatState>();

    return result || null;
  } catch (error) {
    console.error('[AgentState] Error getting state:', error);
    return null;
  }
}

/**
 * List all currently paused chats
 */
export async function listPausedChats(env: Env): Promise<ChatState[]> {
  try {
    const result = await env.DB.prepare(
      `SELECT * FROM chat_states
       WHERE ai_enabled = 0
         OR (paused_until IS NOT NULL AND paused_until > CURRENT_TIMESTAMP)
       ORDER BY updated_at DESC`
    ).all<ChatState>();

    return result.results || [];
  } catch (error) {
    console.error('[AgentState] Error listing paused chats:', error);
    return [];
  }
}

/**
 * Record an escalation event
 */
export async function recordEscalation(
  env: Env,
  chatId: string,
  userQuestion: string,
  reason: string
): Promise<number> {
  try {
    const result = await env.DB.prepare(
      `INSERT INTO escalations (chat_id, user_question, reason)
       VALUES (?, ?, ?)
       RETURNING id`
    )
      .bind(chatId, userQuestion, reason)
      .first<{ id: number }>();

    console.log(`[AgentState] Escalation recorded: ${result?.id}`);
    return result?.id || 0;
  } catch (error) {
    console.error('[AgentState] Error recording escalation:', error);
    return 0;
  }
}

/**
 * Resolve an escalation
 */
export async function resolveEscalation(
  env: Env,
  escalationId: number,
  agentId: string
): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE escalations
       SET agent_id = ?, resolved_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(agentId, escalationId)
      .run();

    console.log(`[AgentState] Escalation ${escalationId} resolved by ${agentId}`);
  } catch (error) {
    console.error('[AgentState] Error resolving escalation:', error);
    throw error;
  }
}
