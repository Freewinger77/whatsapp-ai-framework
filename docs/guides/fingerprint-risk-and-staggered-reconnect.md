# Fingerprint risk + staggered reconnect (Aug 2026)

## Incident pattern (2026-08-03)

Worker restarts caused **mass companion re-login**:

| UK time | Event |
|---|---|
| 08:05 | wasup2 restart → Nordkone 401 |
| 09:02–09:04 | Regent 6h reachout lock + 401; **wasup3 restart**; ATK + Dispatch 401 |
| 10:25 | ATK + Dispatch 401 again (reconnect storm) |
| 10:28 | wasup.co 403 after cold blasts |

## Live audit (pre-fix)

**11 / 15 instances** shared `direct` egress (no proxy) → **high** risk (`sharedWith=10`).

Only Regent / TJ-Katsastus / Nordkone / wasup.co had unique proxy slots (low).

## What we shipped

### 1. Staggered startup reconnect
On worker boot, credentialed instances reconnect **one slot at a time**:

- `WA_STARTUP_RECONNECT_STAGGER_MS` (default **8000**)
- `WA_STARTUP_RECONNECT_JITTER_MS` (default **3000**)

Log: `Scheduling startup auto-reconnect for <id> in Ns (slot k)`

### 2. Staggered runtime reconnect
Conflict (428) and recoverable reconnects add a deterministic fleet offset:

- `WA_RUNTIME_RECONNECT_STAGGER_MS` (default **5000**) × stable slot from instance id

### 3. Fingerprint risk on every instance

Exposed on `GET /api/instances` as `fingerprintRisk`:

| Field | Meaning |
|---|---|
| `fingerprint` | `host:port` or `direct` |
| `sharedWith` | # of **other** instances on this worker with the same fingerprint |
| `risk` | `low` (≤2) · `amber` (3–4) · `high` (5+) |
| `peers` | `{id,name}[]` sharing the fingerprint |
| `label` | human-readable |

Also: `GET /api/fingerprint-risk` for a full audit payload.

Worker UI shows `FP low|amber|high · N` on each instance card.

**Note:** `direct` (no proxy) is treated as one shared fingerprint — Meta sees one Azure outbound IP for the whole pack.

## Operator checklist

1. Deploy this worker build to **wasup2 + wasup3**.
2. Assign **unique proxies** until every connected line is `FP low` (`sharedWith ≤ 2`).
3. Prefer antiban v2 **on** for production senders.
4. After a bounce, watch logs for staggered startup slots — never mass Reconnect-all.
5. Hit `GET /api/fingerprint-risk` after proxy changes to confirm groups.

## Env knobs

```bash
WA_STARTUP_RECONNECT_STAGGER_MS=8000
WA_STARTUP_RECONNECT_JITTER_MS=3000
WA_RUNTIME_RECONNECT_STAGGER_MS=5000
WA_RECONNECT_MAX_ATTEMPTS=8
WA_CONFLICT_RECONNECT_MAX_ATTEMPTS=8
```
