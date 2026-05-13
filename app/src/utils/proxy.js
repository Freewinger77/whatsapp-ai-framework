/**
 * Proxy utilities for Wasup WhatsApp instances.
 *
 * Three-tier resolution:
 *   1. Per-instance override (stored in instances.json, set via API) - highest priority
 *   2. Deployment default (env vars on the Azure app) - fallback
 *   3. None (direct connection) - default
 *
 * Per-instance config semantics:
 *   - null / undefined          -> inherit deployment default
 *   - { enabled: false }        -> explicitly disable (ignore deployment default)
 *   - { enabled: true, url }    -> use this proxy instead of deployment default
 *
 * Supported proxy schemes: http, https, socks4, socks5
 * Example URLs:
 *   http://user:pass@proxy.example.com:8080
 *   socks5://user:pass@proxy.example.com:1080
 *   https://proxy.example.com:3128
 */

import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

const SUPPORTED_TYPES = new Set(['http', 'https', 'socks', 'socks4', 'socks5']);

/**
 * Parse a proxy config from either a URL string or a structured object.
 * Returns a normalized object or null if invalid/empty.
 *
 * @param {string|Object|null} input
 * @returns {{type: string, host: string, port: number, username: string|null, password: string|null}|null}
 */
export function parseProxyConfig(input) {
    if (!input) return null;

    // String URL form: "http://user:pass@host:port"
    if (typeof input === 'string') {
        const trimmed = input.trim();
        if (!trimmed) return null;
        try {
            const url = new URL(trimmed);
            const type = url.protocol.replace(':', '').toLowerCase();
            if (!SUPPORTED_TYPES.has(type)) {
                throw new Error(`Unsupported proxy scheme: ${type}. Use http, https, socks4, or socks5.`);
            }
            const port = url.port ? Number(url.port) : defaultPortFor(type);
            return {
                type,
                host: url.hostname,
                port,
                username: url.username ? decodeURIComponent(url.username) : null,
                password: url.password ? decodeURIComponent(url.password) : null,
            };
        } catch (err) {
            throw new Error(`Invalid proxy URL: ${err.message}`);
        }
    }

    // Object form
    if (typeof input === 'object') {
        if (input.url) return parseProxyConfig(input.url);
        if (!input.host || !input.port) return null;
        const type = (input.type || 'http').toLowerCase();
        if (!SUPPORTED_TYPES.has(type)) {
            throw new Error(`Unsupported proxy type: ${type}`);
        }
        return {
            type,
            host: String(input.host),
            port: Number(input.port),
            username: input.username || null,
            password: input.password || null,
        };
    }

    return null;
}

/**
 * Build a URL string from a normalized proxy config (for use with proxy-agent libs).
 */
export function proxyConfigToUrl(cfg) {
    if (!cfg) return null;
    const auth = cfg.username
        ? `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password || '')}@`
        : '';
    return `${cfg.type}://${auth}${cfg.host}:${cfg.port}`;
}

/**
 * Create a proxy agent suitable for passing to the WhatsApp socket factory `{ agent, fetchAgent }`.
 * Returns null if no config.
 */
export function createProxyAgent(cfg) {
    if (!cfg) return null;
    const url = proxyConfigToUrl(cfg);
    const type = cfg.type;
    if (type === 'http' || type === 'https') {
        return new HttpsProxyAgent(url);
    }
    if (type === 'socks' || type === 'socks4' || type === 'socks5') {
        return new SocksProxyAgent(url);
    }
    return null;
}

/**
 * Read the deployment-level default proxy from environment variables.
 * Preference order:
 *   DEFAULT_PROXY_URL (single URL, easy to set on Azure)
 *   then individual DEFAULT_PROXY_HOST / PORT / TYPE / USERNAME / PASSWORD
 */
export function getDeploymentDefaultProxy() {
    if (process.env.DEFAULT_PROXY_URL) {
        try {
            return parseProxyConfig(process.env.DEFAULT_PROXY_URL);
        } catch (err) {
            console.warn(`[Proxy] Invalid DEFAULT_PROXY_URL: ${err.message}`);
            return null;
        }
    }
    if (process.env.DEFAULT_PROXY_HOST && process.env.DEFAULT_PROXY_PORT) {
        return {
            type: (process.env.DEFAULT_PROXY_TYPE || 'http').toLowerCase(),
            host: process.env.DEFAULT_PROXY_HOST,
            port: Number(process.env.DEFAULT_PROXY_PORT),
            username: process.env.DEFAULT_PROXY_USERNAME || null,
            password: process.env.DEFAULT_PROXY_PASSWORD || null,
        };
    }
    return null;
}

/**
 * Resolve the effective proxy for an instance.
 *
 * @param {Object|null} instanceProxy - raw per-instance config from instances.json
 * @returns {{source: 'api'|'pool'|'deployment'|'disabled'|'none', config: Object|null}}
 *   The `source` distinguishes how the proxy got there:
 *     'api'        - user set this via PUT /api/instances/:id/proxy
 *     'pool'       - auto-assigned from the deployment's proxy pool
 *     'deployment' - falling back to DEFAULT_PROXY_URL
 *     'disabled'   - explicitly turned off for this instance
 *     'none'       - nothing configured (direct connection)
 */
export function resolveEffectiveProxy(instanceProxy) {
    // Explicit instance-level disable wins over deployment default
    if (instanceProxy && instanceProxy.enabled === false) {
        return { source: 'disabled', config: null };
    }

    // Instance-level override (from API or pool)
    if (instanceProxy && (instanceProxy.url || instanceProxy.host)) {
        try {
            const cfg = parseProxyConfig(instanceProxy.url || instanceProxy);
            if (cfg) {
                const src = instanceProxy.source === 'pool' ? 'pool' : 'api';
                return { source: src, config: cfg };
            }
        } catch (err) {
            console.warn(`[Proxy] Instance proxy parse failed, falling back: ${err.message}`);
        }
    }

    // Fallback: deployment default
    const deploymentDefault = getDeploymentDefaultProxy();
    if (deploymentDefault) {
        return { source: 'deployment', config: deploymentDefault };
    }

    return { source: 'none', config: null };
}

/**
 * Produce a safe-to-emit proxy summary (password masked).
 */
export function redactProxy(cfg) {
    if (!cfg) return null;
    return {
        type: cfg.type,
        host: cfg.host,
        port: cfg.port,
        username: cfg.username || null,
        password: cfg.password ? '********' : null,
    };
}

function defaultPortFor(type) {
    switch (type) {
        case 'http': return 8080;
        case 'https': return 443;
        case 'socks':
        case 'socks5': return 1080;
        case 'socks4': return 1080;
        default: return 8080;
    }
}
