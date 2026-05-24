/**
 * Proxy utilities for Wasup WhatsApp instances.
 *
 * Resolution order:
 *   1. Per-instance override (API or pool assignment)
 *   2. Deployment default (DEFAULT_PROXY_URL env)
 *   3. Direct connection
 */

import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

const SUPPORTED_TYPES = new Set(['http', 'https', 'socks', 'socks4', 'socks5']);

export function parseProxyConfig(input) {
    if (!input) return null;

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
 * Accept URL, Webshare shorthand (host:port:user:pass), or structured object.
 */
export function parseFlexibleProxyInput(input) {
    if (!input) return null;
    if (typeof input === 'string') {
        const trimmed = input.trim();
        if (!trimmed) return null;
        if (!/^[a-z]+:\/\//i.test(trimmed) && trimmed.split(':').length === 4) {
            const [host, port, user, pass] = trimmed.split(':');
            return parseProxyConfig({
                host,
                port: Number(port),
                username: user,
                password: pass,
                type: 'http'
            });
        }
        return parseProxyConfig(trimmed);
    }
    if (typeof input === 'object') {
        return parseProxyConfig(input);
    }
    return null;
}

export function proxyConfigToUrl(cfg) {
    if (!cfg) return null;
    const auth = cfg.username
        ? `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password || '')}@`
        : '';
    return `${cfg.type}://${auth}${cfg.host}:${cfg.port}`;
}

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

export function resolveEffectiveProxy(instanceProxy) {
    if (instanceProxy && instanceProxy.enabled === false) {
        return { source: 'disabled', config: null };
    }

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

    const deploymentDefault = getDeploymentDefaultProxy();
    if (deploymentDefault) {
        return { source: 'deployment', config: deploymentDefault };
    }

    return { source: 'none', config: null };
}

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
