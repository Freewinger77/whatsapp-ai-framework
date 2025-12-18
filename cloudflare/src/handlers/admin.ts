/**
 * Admin Handler
 * Endpoints for human agents to control AI behavior
 */

import { Hono } from 'hono';
import type { Env, APIResponse, ChatState } from '../types';
import {
  pauseAI,
  resumeAI,
  getAgentState,
  listPausedChats,
} from '../services/agentState';

const admin = new Hono<{ Bindings: Env }>();

/**
 * Pause AI for a specific chat
 * POST /admin/pause
 * Body: { chatId: string, minutes?: number, agentId?: string }
 */
admin.post('/pause', async (c) => {
  try {
    const body = await c.req.json<{
      chatId: string;
      minutes?: number;
      agentId?: string;
    }>();

    if (!body.chatId) {
      return c.json<APIResponse>({
        success: false,
        error: 'chatId is required',
      }, 400);
    }

    const minutes = body.minutes || parseInt(c.env.AI_PAUSE_DEFAULT_MINUTES);
    const pausedUntil = new Date(Date.now() + minutes * 60 * 1000);

    await pauseAI(c.env, body.chatId, pausedUntil, body.agentId);

    return c.json<APIResponse>({
      success: true,
      data: {
        chatId: body.chatId,
        pausedUntil: pausedUntil.toISOString(),
        minutes,
        agentId: body.agentId,
      }
    });
  } catch (error) {
    console.error('[Admin] Error pausing AI:', error);
    return c.json<APIResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Resume AI for a specific chat
 * POST /admin/resume
 * Body: { chatId: string }
 */
admin.post('/resume', async (c) => {
  try {
    const body = await c.req.json<{ chatId: string }>();

    if (!body.chatId) {
      return c.json<APIResponse>({
        success: false,
        error: 'chatId is required',
      }, 400);
    }

    await resumeAI(c.env, body.chatId);

    return c.json<APIResponse>({
      success: true,
      data: {
        chatId: body.chatId,
        resumed: true,
      }
    });
  } catch (error) {
    console.error('[Admin] Error resuming AI:', error);
    return c.json<APIResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Get AI state for a specific chat
 * GET /admin/state/:chatId
 */
admin.get('/state/:chatId', async (c) => {
  try {
    const chatId = c.req.param('chatId');
    const state = await getAgentState(c.env, chatId);

    return c.json<APIResponse<ChatState | null>>({
      success: true,
      data: state,
    });
  } catch (error) {
    console.error('[Admin] Error getting state:', error);
    return c.json<APIResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * List all paused chats
 * GET /admin/paused
 */
admin.get('/paused', async (c) => {
  try {
    const pausedChats = await listPausedChats(c.env);

    return c.json<APIResponse<ChatState[]>>({
      success: true,
      data: pausedChats,
    });
  } catch (error) {
    console.error('[Admin] Error listing paused chats:', error);
    return c.json<APIResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Telegram webhook for agent buttons
 * POST /admin/telegram-callback
 * This handles button clicks from Telegram notifications
 */
admin.post('/telegram-callback', async (c) => {
  try {
    const body = await c.req.json<{
      callback_query?: {
        id: string;
        data: string; // Format: "pause:chatId:minutes" or "dismiss:chatId"
        from: { id: number; username?: string };
      };
    }>();

    if (!body.callback_query) {
      return c.json<APIResponse>({ success: true, data: { skipped: true } });
    }

    const { data, from } = body.callback_query;
    const [action, chatId, minutesStr] = data.split(':');
    const agentId = from.username || String(from.id);

    if (action === 'pause' && chatId && minutesStr) {
      const minutes = parseInt(minutesStr);
      const pausedUntil = new Date(Date.now() + minutes * 60 * 1000);
      await pauseAI(c.env, chatId, pausedUntil, agentId);

      return c.json<APIResponse>({
        success: true,
        data: { action: 'paused', chatId, minutes, agentId }
      });
    }

    if (action === 'dismiss' && chatId) {
      // Just acknowledge, don't pause
      return c.json<APIResponse>({
        success: true,
        data: { action: 'dismissed', chatId }
      });
    }

    return c.json<APIResponse>({
      success: false,
      error: 'Invalid callback data',
    }, 400);

  } catch (error) {
    console.error('[Admin] Error handling Telegram callback:', error);
    return c.json<APIResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

export const adminHandler = admin;
