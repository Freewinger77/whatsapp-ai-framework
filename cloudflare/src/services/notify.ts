/**
 * Agent Notification Service
 * Sends alerts to human agents via Telegram or Discord
 */

import type { Env, AgentNotification } from '../types';
import { recordEscalation } from './agentState';

/**
 * Notify human agent about an escalation
 */
export async function notifyAgent(
  env: Env,
  notification: AgentNotification
): Promise<void> {
  // Record the escalation first
  await recordEscalation(
    env,
    notification.chatId,
    notification.userQuestion,
    notification.reason
  );

  // Try Telegram first, then Discord
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_AGENT_CHAT_ID) {
    await sendTelegramNotification(env, notification);
  } else if (env.DISCORD_WEBHOOK_URL) {
    await sendDiscordNotification(env, notification);
  } else {
    console.warn('[Notify] No notification channel configured');
  }
}

/**
 * Send notification via Telegram with inline buttons
 */
async function sendTelegramNotification(
  env: Env,
  notification: AgentNotification
): Promise<void> {
  const botToken = env.TELEGRAM_BOT_TOKEN!;
  const chatId = env.TELEGRAM_AGENT_CHAT_ID!;

  // Format the message
  const historyText = notification.conversationHistory.length > 0
    ? notification.conversationHistory
        .slice(-5) // Last 5 messages
        .map(m => `${m.role === 'user' ? '👤' : '🤖'} ${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}`)
        .join('\n')
    : 'No previous messages';

  const message = `
🚨 *New Escalation*

*Chat ID:* \`${notification.chatId}\`
*Question:* ${escapeMarkdown(notification.userQuestion)}
*Reason:* ${escapeMarkdown(notification.reason)}

*Recent History:*
${escapeMarkdown(historyText)}

_Click a button to take over:_
  `.trim();

  // Create inline keyboard with pause options
  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '⏱️ 10 min', callback_data: `pause:${notification.chatId}:10` },
        { text: '⏱️ 15 min', callback_data: `pause:${notification.chatId}:15` },
        { text: '⏱️ 30 min', callback_data: `pause:${notification.chatId}:30` },
      ],
      [
        { text: '❌ Dismiss', callback_data: `dismiss:${notification.chatId}` },
      ],
    ],
  };

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown',
          reply_markup: inlineKeyboard,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telegram API error: ${error}`);
    }

    console.log('[Notify] Telegram notification sent');
  } catch (error) {
    console.error('[Notify] Failed to send Telegram notification:', error);
  }
}

/**
 * Send notification via Discord webhook
 */
async function sendDiscordNotification(
  env: Env,
  notification: AgentNotification
): Promise<void> {
  const webhookUrl = env.DISCORD_WEBHOOK_URL!;

  // Format conversation history
  const historyText = notification.conversationHistory.length > 0
    ? notification.conversationHistory
        .slice(-5)
        .map(m => `${m.role === 'user' ? '👤' : '🤖'} ${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}`)
        .join('\n')
    : 'No previous messages';

  // Create Discord embed
  const embed = {
    title: '🚨 New Escalation',
    color: 0xff6b6b, // Red
    fields: [
      {
        name: 'Chat ID',
        value: `\`${notification.chatId}\``,
        inline: true,
      },
      {
        name: 'Reason',
        value: notification.reason,
        inline: true,
      },
      {
        name: 'Question',
        value: notification.userQuestion.substring(0, 1000),
      },
      {
        name: 'Recent History',
        value: historyText.substring(0, 1000) || 'None',
      },
    ],
    footer: {
      text: `Use /admin/pause endpoint to take over this chat`,
    },
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [embed],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord webhook error: ${error}`);
    }

    console.log('[Notify] Discord notification sent');
  } catch (error) {
    console.error('[Notify] Failed to send Discord notification:', error);
  }
}

/**
 * Escape special characters for Telegram Markdown
 */
function escapeMarkdown(text: string): string {
  return text
    .replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
