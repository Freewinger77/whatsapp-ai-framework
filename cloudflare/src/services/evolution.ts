/**
 * Evolution API Service
 * Handles communication with Evolution API for WhatsApp messaging
 *
 * Note: Evolution API runs on a separate server (different PC)
 * Configure EVOLUTION_API_URL to point to that server
 */

import type { Env, EvolutionSendMessagePayload } from '../types';

/**
 * Send a text message via WhatsApp
 */
export async function sendWhatsAppMessage(
  env: Env,
  payload: EvolutionSendMessagePayload
): Promise<void> {
  const baseUrl = env.EVOLUTION_API_URL.replace(/\/$/, ''); // Remove trailing slash
  const instanceName = env.EVOLUTION_INSTANCE_NAME;

  const url = `${baseUrl}/message/sendText/${instanceName}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.EVOLUTION_API_KEY,
      },
      body: JSON.stringify({
        number: payload.number,
        text: payload.text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Evolution API error: ${response.status} - ${errorText}`);
    }

    console.log(`[Evolution] Message sent to ${payload.number}`);
  } catch (error) {
    console.error('[Evolution] Failed to send message:', error);
    throw error;
  }
}

/**
 * Send a message with buttons (for agent notifications)
 */
export async function sendWhatsAppButtons(
  env: Env,
  number: string,
  title: string,
  description: string,
  buttons: Array<{ buttonId: string; buttonText: string }>
): Promise<void> {
  const baseUrl = env.EVOLUTION_API_URL.replace(/\/$/, '');
  const instanceName = env.EVOLUTION_INSTANCE_NAME;

  const url = `${baseUrl}/message/sendButtons/${instanceName}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.EVOLUTION_API_KEY,
      },
      body: JSON.stringify({
        number,
        title,
        description,
        buttons: buttons.map(b => ({
          type: 'reply',
          reply: {
            id: b.buttonId,
            title: b.buttonText,
          },
        })),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Evolution API error: ${response.status} - ${errorText}`);
    }

    console.log(`[Evolution] Buttons sent to ${number}`);
  } catch (error) {
    console.error('[Evolution] Failed to send buttons:', error);
    throw error;
  }
}

/**
 * Check Evolution API instance status
 */
export async function checkInstanceStatus(env: Env): Promise<{
  connected: boolean;
  state: string;
}> {
  const baseUrl = env.EVOLUTION_API_URL.replace(/\/$/, '');
  const instanceName = env.EVOLUTION_INSTANCE_NAME;

  const url = `${baseUrl}/instance/connectionState/${instanceName}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': env.EVOLUTION_API_KEY,
      },
    });

    if (!response.ok) {
      return { connected: false, state: 'error' };
    }

    const data = await response.json() as { instance: { state: string } };
    return {
      connected: data.instance?.state === 'open',
      state: data.instance?.state || 'unknown',
    };
  } catch (error) {
    console.error('[Evolution] Failed to check status:', error);
    return { connected: false, state: 'error' };
  }
}
