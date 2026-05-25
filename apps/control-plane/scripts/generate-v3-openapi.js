#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';
import {
  CONTROL_PLANE_ENDPOINTS,
  CONTROL_PLANE_INFO,
} from '../../../app/scripts/openapi-endpoint-copy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'public', 'openapi-v3.yaml');

const paths = {};
for (const [key, description] of Object.entries(CONTROL_PLANE_ENDPOINTS)) {
  const [method, route] = key.split(' ');
  const m = method.toLowerCase();
  paths[route] = paths[route] || {};
  paths[route][m] = {
    tags: [tagForRoute(route)],
    summary: summaryFromDescription(description),
    description,
    responses: {
      200: { description: 'Success' },
      401: { description: 'Unauthorized — missing or invalid Clerk session / API key' },
    },
  };
}

const doc = {
  openapi: '3.0.3',
  info: {
    title: 'Wasup Control Plane API (v3)',
    description: CONTROL_PLANE_INFO,
    version: '3.0.0',
  },
  servers: [{ url: 'https://control-plane.wasup.co', description: 'Production control plane' }],
  tags: [
    { name: 'Identity', description: 'Verify authentication and list workspace membership.' },
    { name: 'Connection', description: 'Worker URL, deployment status, and API keys for your org.' },
    { name: 'Organizations', description: 'Create and manage Wasup workspaces (one per user).' },
    { name: 'Instances', description: 'Provision and configure WhatsApp instances on your org worker.' },
    { name: 'Activity', description: 'Search messages and logs shown in the dashboard.' },
    { name: 'Billing', description: 'Stripe checkout, entitlements, and customer portal.' },
    { name: 'Proxy', description: 'Regional proxy pool availability and admin import.' },
    { name: 'Notifications', description: 'In-app alerts for provisioning and billing events.' },
    { name: 'System', description: 'Health checks and destructive workspace reset.' },
  ],
  security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
  paths,
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer' },
      ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
  },
};

fs.writeFileSync(outPath, yaml.stringify(doc, { lineWidth: 0 }));
console.log(`Wrote ${outPath}`);

function tagForRoute(route) {
  if (route.includes('/me')) return 'Identity';
  if (route.includes('/connection')) return 'Connection';
  if (route.includes('/orgs')) return 'Organizations';
  if (route.includes('/instances')) return 'Instances';
  if (route.includes('/deep-dive')) return 'Activity';
  if (route.includes('/billing')) return 'Billing';
  if (route.includes('/proxy')) return 'Proxy';
  if (route.includes('/notifications')) return 'Notifications';
  if (route.includes('/docs') || route.includes('/playground')) return 'Connection';
  return 'System';
}

function summaryFromDescription(text) {
  const first = text.split('\n')[0].replace(/^\*\*|\*\*$/g, '').trim();
  return first.slice(0, 120);
}
