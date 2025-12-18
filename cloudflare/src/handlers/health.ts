/**
 * Health Check Handler
 * Used for monitoring and load balancer health checks
 */

import type { Context } from 'hono';
import type { Env } from '../types';

export const healthHandler = async (c: Context<{ Bindings: Env }>) => {
  const startTime = Date.now();

  // Basic health checks
  const checks: Record<string, boolean> = {
    worker: true,
  };

  // Check KV availability
  try {
    await c.env.CHAT_MEMORY.get('__health_check__');
    checks['kv'] = true;
  } catch {
    checks['kv'] = false;
  }

  // Check D1 availability
  try {
    await c.env.DB.prepare('SELECT 1').first();
    checks['d1'] = true;
  } catch {
    checks['d1'] = false;
  }

  // Check required environment variables
  checks['config'] = !!(
    c.env.EVOLUTION_API_URL &&
    c.env.EVOLUTION_API_KEY &&
    c.env.AUTORAG_NAME
  );

  // Check LLM provider config
  checks['llm'] = c.env.LLM_PROVIDER === 'openai'
    ? !!c.env.OPENAI_API_KEY
    : !!c.env.GEMINI_API_KEY;

  const allHealthy = Object.values(checks).every(Boolean);
  const responseTime = Date.now() - startTime;

  return c.json({
    success: allHealthy,
    status: allHealthy ? 'healthy' : 'degraded',
    checks,
    responseTime: `${responseTime}ms`,
    environment: c.env.ENVIRONMENT || 'development',
    timestamp: new Date().toISOString(),
  }, allHealthy ? 200 : 503);
};
