/**
 * Proxy Pool Manager — auto-assigns Webshare-style proxies per instance.
 */

import { parseProxyConfig, parseFlexibleProxyInput, redactProxy } from './proxy.js';

function slotKey(cfg) {
    return `${cfg.host}:${cfg.port}`;
}

export class ProxyPoolManager {
    constructor(input) {
        /** @type {Array<{id: string, config: Object, assignedTo: string|null}>} */
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
                const cfg = parseFlexibleProxyInput(entry);
                if (!cfg) continue;
                this._appendSlot(cfg);
            } catch (err) {
                console.warn(`[ProxyPool] Skipping invalid pool entry: ${err.message}`);
            }
        }
    }

    _appendSlot(cfg) {
        const id = slotKey(cfg);
        const existing = this.slots.find(s => s.id === id);
        if (existing) return { slot: existing, added: false };
        const slot = { id, config: cfg, assignedTo: null };
        this.slots.push(slot);
        return { slot, added: true };
    }

    addEntry(input) {
        const cfg = parseFlexibleProxyInput(input);
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

    removeEntry(slotId) {
        const idx = this.slots.findIndex(s => s.id === slotId);
        if (idx === -1) return { removed: false, wasAssignedTo: null };
        const [slot] = this.slots.splice(idx, 1);
        return { removed: true, wasAssignedTo: slot.assignedTo };
    }

    serialize() {
        return this.slots.map(s => ({
            type: s.config.type,
            host: s.config.host,
            port: s.config.port,
            username: s.config.username,
            password: s.config.password,
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
            reassigned.push({ instanceId: inst.id, slot: { ...slot.config } });
        }

        return { reassigned, orphaned };
    }

    claimSlot(instanceId) {
        if (!this.isEnabled()) return null;

        const existing = this.slots.find(s => s.assignedTo === instanceId);
        if (existing) return { ...existing.config };

        const free = this.slots.find(s => !s.assignedTo);
        if (!free) return null;
        free.assignedTo = instanceId;
        return { ...free.config };
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
