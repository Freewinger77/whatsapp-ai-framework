/**
 * Proxy Pool Manager — labeled Webshare-style proxies per instance.
 * Slots carry optional label/country for quick-attach (SE1, UK3, …).
 */

import { parseProxyConfig, parseFlexibleProxyInput, redactProxy } from './proxy.js';

function slotKey(cfg) {
    return `${cfg.host}:${cfg.port}`;
}

function normalizeCountry(raw, host) {
    const c = String(raw || '').trim().toUpperCase();
    if (c === 'SE' || c === 'SWEDEN' || c === 'FI' || c === 'FINLAND') return 'SE';
    if (c === 'UK' || c === 'GB' || c === 'UNITED KINGDOM' || c === 'ENGLAND') return 'UK';
    // Heuristic from known Webshare ranges the fleet uses
    if (/^(82\.26\.114\.|96\.62\.194\.)/.test(host || '')) return 'SE';
    if (/^(87\.86\.|212\.212\.|195\.40\.)/.test(host || '')) return 'UK';
    return c || null;
}

function normalizeLabel(raw) {
    const label = String(raw || '').trim().toUpperCase();
    return label || null;
}

export class ProxyPoolManager {
    constructor(input) {
        /** @type {Array<{id: string, label: string|null, country: string|null, config: Object, assignedTo: string|null}>} */
        this.slots = [];

        if (!input) return;

        let entries = [];
        if (Array.isArray(input)) {
            entries = input;
        } else if (typeof input === 'string') {
            entries = input.split(',').map(s => s.trim()).filter(Boolean);
        } else {
            return;
        }

        for (const entry of entries) {
            try {
                this.addEntry(entry);
            } catch (err) {
                console.warn(`[ProxyPool] Skipping invalid pool entry: ${err.message}`);
            }
        }
    }

    _appendSlot(cfg, meta = {}) {
        const id = slotKey(cfg);
        const existing = this.slots.find(s => s.id === id);
        if (existing) {
            if (meta.label && !existing.label) existing.label = normalizeLabel(meta.label);
            if (meta.country && !existing.country) {
                existing.country = normalizeCountry(meta.country, cfg.host);
            }
            return { slot: existing, added: false };
        }
        const slot = {
            id,
            label: normalizeLabel(meta.label),
            country: normalizeCountry(meta.country, cfg.host),
            config: cfg,
            assignedTo: null,
        };
        this.slots.push(slot);
        return { slot, added: true };
    }

    /**
     * @param {string|object} input
     *   string URL/shorthand, or { url|shorthand|host,port,..., label?, country? }
     */
    addEntry(input) {
        let meta = {};
        let cfgInput = input;
        if (input && typeof input === 'object' && !Array.isArray(input)) {
            meta = { label: input.label, country: input.country || input.region || input.regionCode };
            cfgInput = input.shorthand || input.url || input;
            if (typeof cfgInput === 'object' && cfgInput.host) {
                cfgInput = {
                    type: cfgInput.type || input.type || 'http',
                    host: cfgInput.host || input.host,
                    port: cfgInput.port || input.port,
                    username: cfgInput.username ?? input.username,
                    password: cfgInput.password ?? input.password,
                };
            }
        }
        const cfg = typeof cfgInput === 'string'
            ? parseFlexibleProxyInput(cfgInput)
            : parseProxyConfig(cfgInput);
        if (!cfg) throw new Error('Invalid proxy: need host and port (optionally username/password)');
        const { slot, added } = this._appendSlot(cfg, meta);
        return {
            added,
            slot: this._publicSlot(slot),
        };
    }

    _publicSlot(slot) {
        return {
            id: slot.id,
            label: slot.label,
            country: slot.country,
            host: slot.config.host,
            port: slot.config.port,
            type: slot.config.type,
            username: slot.config.username || null,
            assignedTo: slot.assignedTo,
        };
    }

    removeEntry(slotId) {
        const idx = this.slots.findIndex(s => s.id === slotId || s.label === slotId);
        if (idx === -1) return { removed: false, wasAssignedTo: null };
        const [slot] = this.slots.splice(idx, 1);
        return { removed: true, wasAssignedTo: slot.assignedTo };
    }

    findByLabel(label) {
        const want = normalizeLabel(label);
        if (!want) return null;
        return this.slots.find(s => s.label === want) || null;
    }

    findByHostPort(host, port) {
        const id = `${host}:${port}`;
        return this.slots.find(s => s.id === id) || null;
    }

    serialize() {
        return this.slots.map(s => ({
            type: s.config.type,
            host: s.config.host,
            port: s.config.port,
            username: s.config.username,
            password: s.config.password,
            label: s.label || undefined,
            country: s.country || undefined,
        }));
    }

    isEnabled() {
        return this.slots.length > 0;
    }

    size() {
        return this.slots.length;
    }

    reconcile(instances) {
        for (const slot of this.slots) slot.assignedTo = null;

        const orphaned = [];
        const assignedAlready = new Set();

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
                orphaned.push(inst.id);
                continue;
            }
            slot.assignedTo = inst.id;
            assignedAlready.add(inst.id);
        }

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
            reassigned.push({ instanceId: inst.id, slot: { ...slot.config, label: slot.label, country: slot.country } });
        }

        return { reassigned, orphaned };
    }

    claimSlot(instanceId) {
        if (!this.isEnabled()) return null;

        const existing = this.slots.find(s => s.assignedTo === instanceId);
        if (existing) return { ...existing.config, label: existing.label, country: existing.country };

        const free = this.slots.find(s => !s.assignedTo);
        if (!free) return null;
        free.assignedTo = instanceId;
        return { ...free.config, label: free.label, country: free.country };
    }

    /**
     * Mark a catalog/api attach as holding this slot (for UI "in use" chips).
     * Does not change other instances' sticky api overrides.
     */
    markAssigned(instanceId, host, port) {
        const slot = this.findByHostPort(host, port);
        if (!slot) return false;
        // Free previous holder of this slot if different
        if (slot.assignedTo && slot.assignedTo !== instanceId) {
            /* keep sticky api on other instance; just re-point catalog assignment */
        }
        // Clear this instance from any other slot
        for (const s of this.slots) {
            if (s.assignedTo === instanceId) s.assignedTo = null;
        }
        slot.assignedTo = instanceId;
        return true;
    }

    releaseSlot(instanceId) {
        const held = this.slots.find(s => s.assignedTo === instanceId);
        if (held) {
            held.assignedTo = null;
            return true;
        }
        return false;
    }

    isAssignedTo(instanceId) {
        return this.slots.some(s => s.assignedTo === instanceId);
    }

    getCatalog({ instanceLookup } = {}) {
        const lookup = typeof instanceLookup === 'function' ? instanceLookup : () => null;
        const byCountry = { SE: [], UK: [], OTHER: [] };
        for (const s of this.slots) {
            const holder = s.assignedTo ? lookup(s.assignedTo) : null;
            const row = {
                ...this._publicSlot(s),
                inUse: !!s.assignedTo,
                assignedName: holder?.name || null,
                assignedStatus: holder?.status || null,
            };
            const bucket = s.country === 'SE' || s.country === 'UK' ? s.country : 'OTHER';
            byCountry[bucket].push(row);
        }
        for (const key of Object.keys(byCountry)) {
            byCountry[key].sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id)));
        }
        return {
            enabled: this.isEnabled(),
            total: this.slots.length,
            byCountry,
            entries: [...byCountry.SE, ...byCountry.UK, ...byCountry.OTHER],
        };
    }

    getStatus() {
        const used = this.slots.filter(s => s.assignedTo).length;
        return {
            enabled: this.isEnabled(),
            total: this.slots.length,
            used,
            free: this.slots.length - used,
            entries: this.slots.map(s => ({
                id: s.id,
                label: s.label,
                country: s.country,
                ...redactProxy(s.config),
                assignedTo: s.assignedTo,
            })),
        };
    }
}
