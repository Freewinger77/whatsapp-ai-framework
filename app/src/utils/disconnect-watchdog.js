/**
 * Fleet disconnect watchdog.
 *
 * When an instance that was seen connected this process stays non-connected for
 * WASUP_DISCONNECT_ALERT_AFTER_MS (default 10m), WhatsApp-alert WASUP_DISCONNECT_ALERT_TO.
 *
 * Anti-spam:
 *  - Only alert instances observed connected at least once (no flood for ancient dead slots)
 *  - One digest message per contact window
 *  - After any successful contact, mute the recipient for
 *    WASUP_DISCONNECT_ALERT_CONTACT_COOLDOWN_MS (default 10m), fleet-wide via peer fanout
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import axios from 'axios';

const DEFAULT_TO = '447835156367';
const DEFAULT_AFTER_MS = 10 * 60 * 1000;
const DEFAULT_POLL_MS = 60 * 1000;
const DEFAULT_CONTACT_COOLDOWN_MS = 10 * 60 * 1000;

function envBool(name, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function envInt(name, fallback) {
    const n = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function workerLabel() {
    return (
        process.env.WASUP_WORKER_ID ||
        process.env.WASUP_WORKER_LABEL ||
        process.env.HOSTNAME ||
        'worker'
    );
}

function alertTo() {
    return String(process.env.WASUP_DISCONNECT_ALERT_TO || DEFAULT_TO).replace(/\D/g, '');
}

function relayBases() {
    const raw = process.env.WASUP_DISCONNECT_ALERT_RELAYS || '';
    return raw
        .split(/[\s,]+/)
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean);
}

function workerSecret() {
    return String(process.env.WASUP_WORKER_SHARED_SECRET || process.env.API_KEY || '').trim();
}

function hasAuthOnDisk(instance) {
    if (!instance?.authFolder) return false;
    try {
        return fsSync.existsSync(path.join(instance.authFolder, 'creds.json'));
    } catch {
        return false;
    }
}

function isWatchable(status, instance) {
    if (!status?.id) return false;
    const phone = status.phone || status.connectedPhone || status.phoneNumber;
    if (phone) return true;
    if (status.hasSavedCredentials) return true;
    if (instance && hasAuthOnDisk(instance)) return true;
    return false;
}

function isConnected(status) {
    return String(status?.status || '').toLowerCase() === 'connected';
}

function formatDuration(ms) {
    const mins = Math.max(1, Math.round(ms / 60000));
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
}

export class DisconnectWatchdog {
    /**
     * @param {object} opts
     * @param {import('./instance-manager.js').InstanceManager} opts.instanceManager
     * @param {string} [opts.stateDir]
     */
    constructor({ instanceManager, stateDir }) {
        this.instanceManager = instanceManager;
        this.stateDir = stateDir || path.join(process.cwd(), 'instances', '_shared');
        this.stateFile = path.join(this.stateDir, 'disconnect-watchdog.json');
        this.enabled = envBool('WASUP_DISCONNECT_ALERT_ENABLED', true);
        this.afterMs = envInt('WASUP_DISCONNECT_ALERT_AFTER_MS', DEFAULT_AFTER_MS);
        this.pollMs = envInt('WASUP_DISCONNECT_ALERT_POLL_MS', DEFAULT_POLL_MS);
        this.contactCooldownMs = envInt(
            'WASUP_DISCONNECT_ALERT_CONTACT_COOLDOWN_MS',
            DEFAULT_CONTACT_COOLDOWN_MS
        );
        /** @type {Map<string, { since: number, alertedAt: number|null }>} */
        this.tracking = new Map();
        /** @type {Map<string, string>} */
        this._lastPhone = new Map();
        /** Instances observed connected at least once this process — only those can alert. */
        this._seenConnected = new Set();
        /** @type {number} epoch ms — do not WhatsApp the recipient until this time */
        this.contactCooldownUntil = 0;
        this.timer = null;
        this._tickBusy = false;
        this.startedAt = Date.now();
    }

    async start() {
        if (!this.enabled) {
            console.log('[DisconnectWatchdog] disabled (WASUP_DISCONNECT_ALERT_ENABLED=0)');
            return;
        }
        await this._loadState();
        // Silence any leftover due episodes from the previous spammy deploy.
        this._suppressExistingDownEpisodes();
        // Fresh contact mute so we don't immediately re-blast after reload.
        this.contactCooldownUntil = Math.max(this.contactCooldownUntil, Date.now() + this.contactCooldownMs);
        await this._saveState();
        this._fanoutMute(this.contactCooldownUntil).catch(() => {});

        console.log(
            `[DisconnectWatchdog] armed — to=${alertTo()} after=${Math.round(this.afterMs / 1000)}s ` +
            `contactCooldown=${Math.round(this.contactCooldownMs / 1000)}s ` +
            `poll=${Math.round(this.pollMs / 1000)}s worker=${workerLabel()}`
        );
        this.timer = setInterval(() => {
            this.tick().catch((err) => {
                console.warn('[DisconnectWatchdog] tick failed:', err.message);
            });
        }, this.pollMs);
        if (typeof this.timer.unref === 'function') this.timer.unref();
        setTimeout(() => {
            this.tick().catch(() => {});
        }, Math.min(30_000, this.pollMs));
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    /**
     * On boot: mark every currently-down watchable episode as already alerted
     * so we only notify on fresh connect→disconnect transitions going forward.
     */
    _suppressExistingDownEpisodes() {
        const now = Date.now();
        const instances = this.instanceManager.getAllInstances() || [];
        for (const st of instances) {
            const live = this.instanceManager.getInstance(st.id);
            if (!isWatchable(st, live)) continue;
            if (isConnected(st)) {
                this._seenConnected.add(st.id);
                const phone = st.phone || st.connectedPhone || live?.connectedPhone;
                if (phone) this._lastPhone.set(st.id, phone);
                this.tracking.delete(st.id);
                continue;
            }
            // Down at boot / after reload — do not page for these.
            this.tracking.set(st.id, { since: now, alertedAt: now });
        }
        console.log(
            `[DisconnectWatchdog] suppressed ${[...this.tracking.values()].filter((e) => e.alertedAt).length} already-down episode(s); mute until ${new Date(this.contactCooldownUntil).toISOString()}`
        );
    }

    _isContactMuted(now = Date.now()) {
        return now < this.contactCooldownUntil;
    }

    applyContactMute(untilMs, { source = 'local' } = {}) {
        const until = Number(untilMs) || 0;
        if (until > this.contactCooldownUntil) {
            this.contactCooldownUntil = until;
            console.log(
                `[DisconnectWatchdog] contact mute until ${new Date(until).toISOString()} (via ${source})`
            );
            this._saveState().catch(() => {});
        }
        return { success: true, contactCooldownUntil: this.contactCooldownUntil };
    }

    async tick() {
        if (!this.enabled || !this.instanceManager || this._tickBusy) return;
        this._tickBusy = true;
        try {
            const instances = this.instanceManager.getAllInstances() || [];
            const now = Date.now();
            let dirty = false;
            /** @type {Array<{ st: any, downFor: number }>} */
            const due = [];

            for (const st of instances) {
                const live = this.instanceManager.getInstance(st.id);
                if (!isWatchable(st, live)) {
                    if (this.tracking.has(st.id)) {
                        this.tracking.delete(st.id);
                        dirty = true;
                    }
                    continue;
                }

                if (isConnected(st)) {
                    this._seenConnected.add(st.id);
                    const livePhone = st.phone || st.connectedPhone || live?.connectedPhone;
                    if (livePhone) this._lastPhone.set(st.id, livePhone);
                    if (this.tracking.has(st.id)) {
                        this.tracking.delete(st.id);
                        dirty = true;
                        console.log(`[DisconnectWatchdog] ${st.id} back online — episode cleared`);
                    }
                    continue;
                }

                // Never page for instances we have not seen connected this process.
                if (!this._seenConnected.has(st.id)) {
                    if (!this.tracking.has(st.id)) {
                        this.tracking.set(st.id, { since: now, alertedAt: now });
                        dirty = true;
                    }
                    continue;
                }

                let ep = this.tracking.get(st.id);
                if (!ep) {
                    ep = { since: now, alertedAt: null };
                    this.tracking.set(st.id, ep);
                    dirty = true;
                    continue;
                }

                const downFor = now - ep.since;
                if (ep.alertedAt || downFor < this.afterMs) continue;
                due.push({ st, downFor });
            }

            const liveIds = new Set(instances.map((i) => i.id));
            for (const id of [...this.tracking.keys()]) {
                if (!liveIds.has(id)) {
                    this.tracking.delete(id);
                    dirty = true;
                }
            }

            if (due.length) {
                if (this._isContactMuted(now)) {
                    console.log(
                        `[DisconnectWatchdog] ${due.length} due alert(s) held — contact mute ` +
                        `until ${new Date(this.contactCooldownUntil).toISOString()}`
                    );
                } else {
                    const sent = await this._sendDigest(due);
                    if (sent) {
                        for (const { st } of due) {
                            const ep = this.tracking.get(st.id);
                            if (ep) ep.alertedAt = now;
                        }
                        this.contactCooldownUntil = now + this.contactCooldownMs;
                        dirty = true;
                        this._fanoutMute(this.contactCooldownUntil).catch(() => {});
                    }
                }
            }

            if (dirty) await this._saveState();
        } finally {
            this._tickBusy = false;
        }
    }

    async _sendDigest(due) {
        const to = alertTo();
        if (!to) {
            console.warn('[DisconnectWatchdog] no alert recipient configured');
            return false;
        }

        const lines = due.map(({ st, downFor }) => {
            const phone =
                st.phone ||
                st.connectedPhone ||
                st.phoneNumber ||
                this._lastPhone.get(st.id) ||
                'unknown';
            return `• ${st.name || st.id} | ${phone} | ${st.status} | down ${formatDuration(downFor)} | ${st.id}`;
        });

        const msg = [
            `⚠️ Wasup disconnect alert (${due.length})`,
            `Worker: ${workerLabel()}`,
            `Time: ${new Date().toISOString()}`,
            '',
            ...lines.slice(0, 15),
            ...(lines.length > 15 ? [`… +${lines.length - 15} more`] : []),
        ].join('\n');

        const local = await this._sendLocal(to, msg);
        if (local.ok) {
            console.log(`[DisconnectWatchdog] digest to ${to} via local ${local.via} (${due.length} instances)`);
            return true;
        }

        const relayed = await this._sendViaRelays(to, msg);
        if (relayed.ok) {
            console.log(`[DisconnectWatchdog] digest to ${to} via relay ${relayed.via} (${due.length} instances)`);
            return true;
        }

        console.warn(
            `[DisconnectWatchdog] FAILED digest: local=${local.error || 'n/a'} relay=${relayed.error || 'n/a'}`
        );
        return false;
    }

    async _sendLocal(to, message) {
        try {
            if (this._isContactMuted()) {
                return { ok: false, error: 'contact-muted' };
            }
            const sender = this._pickSender();
            if (!sender) return { ok: false, error: 'no-connected-sender' };
            await this.instanceManager.sendMessage(sender.id, to, message, {
                skipContactSave: true,
                typingSimulation: false,
                delayEnabled: false,
                allowColdWithoutToken: true,
                skipPrivacyToken: true,
                forceDespiteHandoff: true,
            });
            return { ok: true, via: `${sender.name || sender.id}` };
        } catch (err) {
            return { ok: false, error: err.message || String(err) };
        }
    }

    _pickSender() {
        const connected = (this.instanceManager.getAllInstances() || []).filter(isConnected);
        if (!connected.length) return null;
        return connected[0];
    }

    async _sendViaRelays(to, message) {
        const secret = workerSecret();
        const bases = relayBases();
        if (!bases.length) return { ok: false, error: 'no-relays' };
        if (!secret) return { ok: false, error: 'no-secret' };

        let lastErr = 'none';
        for (const base of bases) {
            try {
                const res = await axios.post(
                    `${base}/api/system/relay-alert-send`,
                    {
                        to,
                        message,
                        fromWorker: workerLabel(),
                    },
                    {
                        timeout: 90_000,
                        headers: {
                            'Content-Type': 'application/json',
                            'X-API-Key': secret,
                            Authorization: `Bearer ${secret}`,
                            'X-Wasup-Worker-Secret': secret,
                        },
                        validateStatus: () => true,
                    }
                );
                if (res.status >= 200 && res.status < 300 && res.data?.success) {
                    if (res.data.contactCooldownUntil) {
                        this.applyContactMute(res.data.contactCooldownUntil, { source: base });
                    }
                    return { ok: true, via: base };
                }
                lastErr = `${base}:${res.status}:${res.data?.error || 'fail'}`;
            } catch (err) {
                lastErr = `${base}:${err.message}`;
            }
        }
        return { ok: false, error: lastErr };
    }

    async _fanoutMute(untilMs) {
        const secret = workerSecret();
        const bases = relayBases();
        if (!secret || !bases.length) return;
        await Promise.all(
            bases.map(async (base) => {
                try {
                    await axios.post(
                        `${base}/api/system/disconnect-alert-mute`,
                        { until: untilMs, fromWorker: workerLabel() },
                        {
                            timeout: 8_000,
                            headers: {
                                'Content-Type': 'application/json',
                                'X-API-Key': secret,
                                Authorization: `Bearer ${secret}`,
                                'X-Wasup-Worker-Secret': secret,
                            },
                            validateStatus: () => true,
                        }
                    );
                } catch {
                    /* ignore peer mute failures */
                }
            })
        );
    }

    /**
     * Handle inbound relay request from a peer worker.
     */
    async handleRelaySend({ to, message }) {
        const dest = String(to || alertTo()).replace(/\D/g, '');
        if (!dest || !message) {
            return { success: false, error: 'to and message required' };
        }
        if (this._isContactMuted()) {
            return {
                success: false,
                error: 'contact-muted',
                contactCooldownUntil: this.contactCooldownUntil,
            };
        }
        const result = await this._sendLocal(dest, String(message));
        if (!result.ok) {
            return { success: false, error: result.error || 'send failed' };
        }
        const until = Date.now() + this.contactCooldownMs;
        this.applyContactMute(until, { source: 'relay-send' });
        this._fanoutMute(until).catch(() => {});
        return {
            success: true,
            via: result.via,
            to: dest,
            contactCooldownUntil: this.contactCooldownUntil,
        };
    }

    getStatus() {
        const rows = [];
        for (const [id, ep] of this.tracking) {
            rows.push({
                id,
                since: new Date(ep.since).toISOString(),
                downMs: Date.now() - ep.since,
                alertedAt: ep.alertedAt ? new Date(ep.alertedAt).toISOString() : null,
                seenConnected: this._seenConnected.has(id),
            });
        }
        return {
            enabled: this.enabled,
            to: alertTo(),
            afterMs: this.afterMs,
            pollMs: this.pollMs,
            contactCooldownMs: this.contactCooldownMs,
            contactCooldownUntil: this.contactCooldownUntil
                ? new Date(this.contactCooldownUntil).toISOString()
                : null,
            contactMuted: this._isContactMuted(),
            worker: workerLabel(),
            tracking: rows,
            seenConnectedCount: this._seenConnected.size,
            relays: relayBases(),
        };
    }

    async _loadState() {
        try {
            if (!fsSync.existsSync(this.stateFile)) return;
            const raw = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
            const episodes = raw?.episodes || {};
            for (const [id, ep] of Object.entries(episodes)) {
                const since = Date.parse(ep.since || '');
                if (!Number.isFinite(since)) continue;
                this.tracking.set(id, {
                    since,
                    alertedAt: ep.alertedAt ? Date.parse(ep.alertedAt) || null : null,
                });
            }
            const until = Date.parse(raw?.contactCooldownUntil || '');
            if (Number.isFinite(until)) this.contactCooldownUntil = until;
        } catch (err) {
            console.warn('[DisconnectWatchdog] state load failed:', err.message);
        }
    }

    async _saveState() {
        try {
            await fs.mkdir(this.stateDir, { recursive: true });
            const episodes = {};
            for (const [id, ep] of this.tracking) {
                episodes[id] = {
                    since: new Date(ep.since).toISOString(),
                    alertedAt: ep.alertedAt ? new Date(ep.alertedAt).toISOString() : null,
                };
            }
            await fs.writeFile(
                this.stateFile,
                JSON.stringify(
                    {
                        updatedAt: new Date().toISOString(),
                        contactCooldownUntil: this.contactCooldownUntil
                            ? new Date(this.contactCooldownUntil).toISOString()
                            : null,
                        episodes,
                    },
                    null,
                    2
                )
            );
        } catch (err) {
            console.warn('[DisconnectWatchdog] state save failed:', err.message);
        }
    }
}

let singleton = null;

export function startDisconnectWatchdog(instanceManager, { instancesFolder } = {}) {
    if (singleton) {
        singleton.stop();
    }
    const stateDir = instancesFolder
        ? path.join(instancesFolder, '_shared')
        : path.join(process.cwd(), 'instances', '_shared');
    singleton = new DisconnectWatchdog({ instanceManager, stateDir });
    singleton.start().catch((err) => {
        console.warn('[DisconnectWatchdog] start failed:', err.message);
    });
    return singleton;
}

export function getDisconnectWatchdog() {
    return singleton;
}
