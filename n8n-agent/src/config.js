import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} path
 * @returns {Record<string, string>}
 */
export function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * @param {{ baseUrl?: string, apiKey?: string }} [overrides]
 */
export function loadConfig(overrides = {}) {
  const fileEnv = {
    ...parseEnvFile(resolve(here, '../../.env')),
    ...parseEnvFile(resolve(here, '../.env')),
  };

  const baseUrl = String(
    overrides.baseUrl || process.env.N8N_BASE_URL || fileEnv.N8N_BASE_URL || ''
  ).replace(/\/+$/, '');
  const apiKey = String(overrides.apiKey || process.env.N8N_API_KEY || fileEnv.N8N_API_KEY || '');

  if (!baseUrl) {
    throw new Error('N8N_BASE_URL is required (env or n8n-agent/.env)');
  }
  if (!apiKey) {
    throw new Error('N8N_API_KEY is required (env or n8n-agent/.env)');
  }

  return { baseUrl, apiKey };
}
