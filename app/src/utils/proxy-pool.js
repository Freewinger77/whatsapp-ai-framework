/**
 * Proxy Pool Manager
 *
 * Loads a finite list of proxies from the PROXY_POOL env var and auto-assigns
 * one slot per WhatsApp instance on creation. When an instance is deleted (or
 * explicitly overrides its proxy via the API), the slot is returned to the
 * pool and reused on the next create/reconcile call.
 *
 * Pool state is DERIVED from the current set of instances: a slot is
 * "assigned" iff some instance has `proxy.source === 'pool'` with the same
 * host:port. No separate on-disk state is kept; this removes a whole class
 * of drift bugs.
 *
 * Env var format (comma-separated proxy URLs):
 *   PROXY_POOL=http://user:pass@host1:port,http://user:pass@host2:port,...
 */

import { parseProxyConfig, redactProxy } from './proxy.js';

function slotKey(cfg) {
    return `${cfg.host}:${cfg.port}`;
}

/**
 * Accepts any of:
 *   - a URL string:              "http://user:pass@host:port"
 *   - a webshare shorthand line: "host:port:user:pass"
 *   - an object:                 { host, port, username?, password?, type? }
 *     or { url: "..." }
 * Returns normalized config or null.
 */
function parseProxyConfigFlexible(input) {
    if (!input) return null;
    if (typeof input === 'string') {
        const trimmed = input.trim();
        if (!trimmed) return null;
        // Webshare shorthand has no scheme and exactly 3 colons: host:port:user:pass
        if (!/^[a-z]+:\/\//i.test(trimmed) && trimmed.split(':').length === 4) {
            const [host, port, user, pass] = trimmed.split(':');
            return parseProxyConfig({ host, port: Number(port), username: user, password: pass, type: 'http' });
        }
        return parseProxyConfig(trimmed);
    }
    if (typeof input === 'object') {
        return parseProxyConfig(input);
    }
    return null;
}

export class ProxyPoolManager {
    /**
     * @param {string|Array<Object>} input - PROXY_POOL env string OR an array of normalized configs
     */
    constructor(input) {
        /** @type {Array<{id: string, config: Object, assignedTo: string|null}>} */
        this.slots = [];

        if (!input) return;

        let entries = [];
        if (Array.isArray(input)) {
            // Structured form (from proxy-pool.json)
            entries = input;
        } else if (typeof input === 'string') {
            entries = input.split(',').map(s => s.trim()).filter(Boolean);
        } else {
            return;
        }

        for (const entry of entries) {
            try {
                const cfg = parseProxyConfig(entry);
                if (!cfg) continue;
                this._appendSlot(cfg);
            } catch (err) {
                console.warn(`[ProxyPool] Skipping invalid pool entry: ${err.message}`);
            }
        }
    }

    /**
     * Internal: push a slot if not already present. Returns the slot (new or existing).
     */
    _appendSlot(cfg) {
        const id = slotKey(cfg);
        const existing = this.slots.find(s => s.id === id);
        if (existing) return { slot: existing, added: false };
        const slot = { id, config: cfg, assignedTo: null };
        this.slots.push(slot);
        return { slot, added: true };
    }

    /**
     * Add a new proxy to the pool at runtime.
     * Accepts either a URL string, an object {host, port, username, password, type}
     * or the webshare shorthand "host:port:user:pass".
     *
     * Returns { added: boolean, slot: {...} }.
     *   added=false means the host:port was already in the pool (idempotent).
     */
    addEntry(input) {
        const cfg = parseProxyConfigFlexible(input);
        if (!cfg) throw new Error('Invalid proxy: need host and port (optionally username/password)');
        const { slot, added } = this._appendSlot(cfg);
        return {
            added,
            slot: {
                id: slot.id,
                host: slot.config.host,
                port: slot.config.port,
                type: slot.config.type,
                username: slot.config.username || null,
                assignedTo: slot.assignedTo,
            },
        };
    }

    /**
     * Remove a proxy from the pool by slot id (host:port).
     * Returns { removed: boolean, wasAssignedTo: string|null }.
     */
    removeEntry(slotId) {
        const idx = this.slots.findIndex(s => s.id === slotId);
        if (idx === -1) return { removed: false, wasAssignedTo: null };
        const [slot] = this.slots.splice(idx, 1);
        return { removed: true, wasAssignedTo: slot.assignedTo };
    }

    /**
     * Serialize the current pool as plain JSON (for persistence).
     */
    serialize() {
        return this.slots.map(s => ({
            type: s.config.type,
            host: s.config.host,
            port: s.config.port,
            username: s.config.username,
            password: s.config.password,
        }));
    }

    /**
     * True if this deployment has any pool configured.
     */
    isEnabled() {
        return this.slots.length > 0;
    }

    size() {
        return this.slots.length;
    }

    /**
     * Sync in-memory assignments from the authoritative list of instances.
     *
     * Reads each instance's `proxy` field. Slot assignments are rebuilt from
     * scratch on every call, so this is safe to call repeatedly (e.g. on boot
     * and on pool reconfiguration).
     *
     * @param {Array<{id: string, proxy: Object|null, createdAt: string}>} instances
     * @returns {{reassigned: Array<{instanceId: string, slot: Object}>, orphaned: Array<string>}}
     *   reassigned: instances that had no pool slot but now got one (oldest-first)
     *   orphaned:   instance IDs whose proxy referenced a slot no longer in the pool
     */
    reconcile(instances) {
        // Reset all assignments
        for (const slot of this.slots) slot.assignedTo = null;

        const orphaned = [];
        const assignedAlready = new Set();

        // Pass 1: keep existing valid assignments
        for (const inst of instances) {
            const p = inst.proxy;
            if (!p || p.source !== 'pool' || !p.host || !p.port) continue;
            const key = `${p.host}:${p.port}`;
            const slot = this.slots.find(s => s.id === key);
            if (!slot) {
                orphaned.push(inst.id);
                continue;
            }
            if (slot.assignedTo) {
                // Duplicate assignment (shouldn't happen, but guard)
                orphaned.push(inst.id);
                continue;
            }
            slot.assignedTo = inst.id;
            assignedAlready.add(inst.id);
        }

        // Pass 2: retroactively claim free slots for instances that don't have
        // an API override, don't have a pool slot yet, and aren't explicitly
        // disabled. Oldest first (by createdAt).
        const reassigned = [];
        const candidates = instances
            .filter(i => !assignedAlready.has(i.id))
            .filter(i => !i.proxy || (i.proxy.source !== 'api' && i.proxy.enabled !== false))
            .sort((a, b) => {
                const ta = new Date(a.createdAt || 0).getTime();
                const tb = new Date(b.createdAt || 0).getTime();
                return ta - tb;
            });

        for (const inst of candidates) {
            const slot = this.slots.find(s => !s.assignedTo);
            if (!slot) break;
            slot.assignedTo = inst.id;
            reassigned.push({ instanceId: inst.id, slot: { ...slot.config } });
        }

        return { reassigned, orphaned };
    }

    /**
     * Claim the next free slot for a given instance. Returns the proxy config
     * (normalized) or null if the pool is exhausted.
     */
    claimSlot(instanceId) {
        if (!this.isEnabled()) return null;

        // Already holds a slot? Idempotent return.
        const existing = this.slots.find(s => s.assignedTo === instanceId);
        if (existing) return { ...existing.config };

        const free = this.slots.find(s => !s.assignedTo);
        if (!free) return null;
        free.assignedTo = instanceId;
        return { ...free.config };
    }

    /**
     * Release whichever slot is held by the given instance (if any).
     */
    releaseSlot(instanceId) {
        const held = this.slots.find(s => s.assignedTo === instanceId);
        if (held) {
            held.assignedTo = null;
            return true;
        }
        return false;
    }

    /**
     * True if this instance currently holds a pool slot.
     */
    isAssignedTo(instanceId) {
        return this.slots.some(s => s.assignedTo === instanceId);
    }

    /**
     * Redacted pool state for API responses.
     */
    getStatus() {
        const used = this.slots.filter(s => s.assignedTo).length;
        return {
            enabled: this.isEnabled(),
            total: this.slots.length,
            used,
            free: this.slots.length - used,
            entries: this.slots.map(s => ({
                id: s.id,
                ...redactProxy(s.config),
                assignedTo: s.assignedTo,
            })),
        };
    }
}
