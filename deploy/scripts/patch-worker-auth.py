#!/usr/bin/env python3
"""Fix worker authenticateAPI 500s (missing verifyApiKeyAccess + no sk-prod validation)."""
from __future__ import annotations

import sys
from pathlib import Path

AUTH_HELPERS = """
const CUSTOMER_KEY_AUTH_CACHE_TTL_MS = 60_000;
const customerKeyAuthCache = new Map();

function getHostnameFromRequest(req) {
    return String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
}

function requiredScopeForRequest(req) {
    const path = req.path || '';
    if (/\\/(?:send|react)(?:\\/|$)/.test(path)) return 'messages:send';
    if (req.method === 'GET') return 'instances:read';
    return 'instances:write';
}

async function validateCustomerApiKeyForHost(apiKey, hostname, requiredScope = 'instances:read') {
    const key = String(apiKey || '').trim();
    const host = String(hostname || '').trim().toLowerCase();
    if (!key || !/^sk-(?:prod|dev)-/i.test(key)) {
        return { valid: false };
    }

    if (!WASUP_WORKER_SHARED_SECRET || !WASUP_CONTROL_PLANE_URL) {
        return { valid: false, message: 'Worker authentication is not configured.' };
    }

    const cacheKey = crypto
        .createHash('sha256')
        .update(`${host}:${requiredScope}:${key}`)
        .digest('hex');
    const cached = customerKeyAuthCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
    }

    try {
        const response = await axios.post(
            `${WASUP_CONTROL_PLANE_URL}/api/internal/worker-auth`,
            { apiKey: key, hostname: host, requiredScope },
            {
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json',
                    'x-wasup-worker-secret': WASUP_WORKER_SHARED_SECRET,
                },
                validateStatus: () => true,
            }
        );
        const data = response.data || {};
        const result = data.valid
            ? { valid: true, orgId: data.orgId, orgSlug: data.orgSlug, keyKind: data.keyKind, scopes: data.scopes || [] }
            : { valid: false, message: data.message || data.reason || 'Invalid API key.' };

        customerKeyAuthCache.set(cacheKey, {
            result,
            expiresAt: Date.now() + CUSTOMER_KEY_AUTH_CACHE_TTL_MS,
        });
        return result;
    } catch (error) {
        console.error('[Auth] Control-plane key validation failed:', error.response?.status || error.message);
        return { valid: false, message: 'Could not validate the API key right now.' };
    }
}
"""

AUTH_FN_START = "function authenticateAPI(req, res, next) {"
AUTH_FN_END = "function authorizeInstanceScope(req, res, next) {"

NEW_AUTH_FN = """
async function authenticateAPI(req, res, next) {
    try {
        if (
            req.path === '/health'
            || req.path.startsWith('/internal')
            || req.path.startsWith('/docs')
            || req.path === '/openapi.yaml'
            || req.path === '/openapi.json'
        ) {
            return next();
        }

        const openApi = !API_KEY;
        if (openApi) {
            req.auth = { type: 'open' };
            return next();
        }

        if (isSameOriginDashboardRequest(req)) {
            req.auth = { type: 'dashboard' };
            return next();
        }

        const token = extractAuthToken(req);

        if (API_KEY && token === API_KEY) {
            req.auth = { type: 'deployment' };
            return next();
        }

        if (WASUP_WORKER_SHARED_SECRET && token === WASUP_WORKER_SHARED_SECRET) {
            req.auth = { type: 'deployment' };
            return next();
        }

        if (ADMIN_PASSWORD && token === ADMIN_PASSWORD) {
            req.auth = { type: 'admin' };
            return next();
        }

        if (token && instanceManager && typeof instanceManager.verifyApiKeyAccess === 'function') {
            const routeInstanceId = resolveRouteInstanceId(req);
            const match = instanceManager.verifyApiKeyAccess(token, routeInstanceId);
            if (match) {
                req.auth = { type: 'instance', instanceId: match.instanceId };
                return next();
            }

            if (!routeInstanceId) {
                const anyMatch = instanceManager.verifyApiKeyAccess(token);
                if (anyMatch) {
                    req.auth = { type: 'instance', instanceId: anyMatch.instanceId };
                    return next();
                }
            }
        }

        if (token && WASUP_CONTROL_PLANE_URL && WASUP_WORKER_SHARED_SECRET) {
            const customerAuth = await validateCustomerApiKeyForHost(
                token,
                getHostnameFromRequest(req),
                requiredScopeForRequest(req)
            );
            if (customerAuth.valid) {
                req.auth = { type: 'customer', orgId: customerAuth.orgId };
                return next();
            }
        }

        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Valid deployment API key, org API key, or per-instance wsp_v3_* key required.',
        });
    } catch (error) {
        console.error('[Auth] authenticateAPI failed:', error);
        return res.status(500).json({
            error: 'Internal Server Error',
            message: 'Authentication failed.',
        });
    }
}

function authorizeInstanceScope(req, res, next) {"""

def patch_server(path: Path) -> None:
    text = path.read_text()

    if "validateCustomerApiKeyForHost" not in text:
        anchor = "function resolveRouteInstanceId(req) {"
        if anchor not in text:
            raise SystemExit("resolveRouteInstanceId anchor missing in server.js")
        text = text.replace(anchor, AUTH_HELPERS + "\n" + anchor, 1)

    start = text.find(AUTH_FN_START)
    end = text.find(AUTH_FN_END)
    if start == -1 or end == -1:
        raise SystemExit("authenticateAPI block not found in server.js")
    text = text[:start] + NEW_AUTH_FN + text[end + len(AUTH_FN_END):]

    text = text.replace(
        "['deployment', 'admin', 'dashboard', 'open', 'internal'].includes(req.auth.type)",
        "['deployment', 'admin', 'dashboard', 'open', 'internal', 'customer'].includes(req.auth.type)",
        1,
    )

    path.write_text(text)
    print("server.js auth patched")


def patch_instance_manager(path: Path) -> None:
    text = path.read_text()
    if "verifyApiKeyAccess" in text:
        print("instance-manager.js already has verifyApiKeyAccess")
        return

    import_line = "import { verifyApiKeyForInstance } from './instance-api-keys.js';\n"
    if "instance-api-keys.js" not in text:
        anchor = "import { ProxyPoolManager } from './proxy-pool.js';"
        if anchor not in text:
            raise SystemExit("instance-manager import anchor missing")
        text = text.replace(anchor, anchor + "\n" + import_line, 1)

    method = """
    verifyApiKeyAccess(token, routeInstanceId = null) {
        if (!token) return null;
        const matches = [];

        for (const [id, instance] of this.instances.entries()) {
            if (routeInstanceId && id !== routeInstanceId) continue;
            const meta = instance.apiKeyMeta || instance.apiKey || null;
            if (meta && verifyApiKeyForInstance(token, meta)) {
                matches.push(id);
            }
        }

        if (matches.length === 1) {
            return { instanceId: matches[0] };
        }
        return null;
    }
"""

    anchor = "    _generateId() {"
    if anchor not in text:
        raise SystemExit("_generateId anchor missing in instance-manager.js")
    text = text.replace(anchor, method + "\n" + anchor, 1)
    path.write_text(text)
    print("instance-manager.js verifyApiKeyAccess added")


def main() -> None:
    root = Path(sys.argv[1])
    patch_server(root / "server.js")
    patch_instance_manager(root / "src/utils/instance-manager.js")


if __name__ == "__main__":
    main()
