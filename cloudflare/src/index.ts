/**
 * WhatsApp AI Chatbot - Main Entry Point
 * Cloudflare Worker using Hono framework
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import type { Env } from './types';
import { webhookHandler } from './handlers/webhook';
import { adminHandler } from './handlers/admin';
import { healthHandler } from './handlers/health';

// Create Hono app with typed environment bindings
const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use('*', logger());
app.use('*', secureHeaders());
app.use('*', cors({
  origin: '*', // Restrict in production
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

// Health check endpoint
app.get('/', healthHandler);
app.get('/health', healthHandler);

// WhatsApp webhook endpoint (Evolution API calls this)
app.post('/webhook', webhookHandler);

// Admin endpoints for agent control
app.route('/admin', adminHandler);

// 404 handler
app.notFound((c) => {
  return c.json({
    success: false,
    error: 'Not Found',
    path: c.req.path,
  }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({
    success: false,
    error: c.env.ENVIRONMENT === 'production'
      ? 'Internal Server Error'
      : err.message,
  }, 500);
});

export default app;
