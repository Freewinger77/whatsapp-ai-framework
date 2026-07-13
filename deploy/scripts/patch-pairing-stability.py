#!/usr/bin/env python3
"""Stop pairing-code rotation: reuse active code, preserve on transient disconnect."""
from pathlib import Path
import sys

root = Path(sys.argv[1])
server_path = root / "server.js"
im_path = root / "src/utils/instance-manager.js"

server = server_path.read_text()
connect_marker = """app.post('/api/instances/:id/connect', async (req, res) => {
    console.log(`[API] Connect request for instance: ${req.params.id}`);
    try {
        const options = {};
        const pairingPhone = req.body.pairingPhone || req.body.phoneNumber || req.body.phone;"""

connect_patch = """app.post('/api/instances/:id/connect', async (req, res) => {
    console.log(`[API] Connect request for instance: ${req.params.id}`);
    try {
        const options = {};
        const pairingPhone = req.body.pairingPhone || req.body.phoneNumber || req.body.phone;
        if (pairingPhone) {
            const cleanPhone = String(pairingPhone).replace(/^\\+/, '').replace(/[\\s\\-\\(\\)]/g, '');
            const inst = instanceManager.getInstance(req.params.id);
            if (inst?.pairingCode && inst.pairingPhoneTarget === cleanPhone && inst.pairingCodeIssuedAt) {
                const ageMs = Date.now() - new Date(inst.pairingCodeIssuedAt).getTime();
                if (ageMs >= 0 && ageMs < 120000) {
                    return res.json({
                        success: true,
                        reused: true,
                        pairingCode: inst.pairingCode,
                        message: `Pairing code still active: ${inst.pairingCode}. Enter it in WhatsApp now — do not refresh.`,
                        instance: inst.getStatus(),
                    });
                }
            }
        }"""

if "reused: true" not in server:
    if connect_marker not in server:
        raise SystemExit("server connect marker missing")
    server_path.write_text(server.replace(connect_marker, connect_patch, 1))
    print("server.js pairing reuse patched")
else:
    print("server.js already patched")

im = im_path.read_text()

if "this.pairingCodeIssuedAt" not in im:
    im = im.replace(
        "        this.pairingCode = null; // For pairing code login (alternative to QR)",
        "        this.pairingCode = null; // For pairing code login (alternative to QR)\n        this.pairingCodeIssuedAt = null;\n        this.pairingPhoneTarget = null;",
        1,
    )

if "this.pairingPhoneTarget = cleanNumber" not in im:
    old = """                const code = await this.socket.requestPairingCode(cleanNumber);
                this.pairingCode = code;"""
    if old not in im:
        raise SystemExit("pairing code assign block missing")
    im = im.replace(
        old,
        """                const code = await this.socket.requestPairingCode(cleanNumber);
                this.pairingCode = code;
                this.pairingCodeIssuedAt = new Date().toISOString();
                this.pairingPhoneTarget = cleanNumber;""",
        1,
    )

if "preservePairingCode" not in im:
    old = """                    if (!wasPairing || (!isQrTimeout && !isStaleProtocol)) {
                        this.qrCode = null;
                        this.qrContent = null;
                        this.qrCodeUpdatedAt = null;
                    }
                    this.pairingCode = null;"""
    if old not in im:
        raise SystemExit("pairing clear block missing")
    im = im.replace(
        old,
        """                    if (!wasPairing || (!isQrTimeout && !isStaleProtocol)) {
                        this.qrCode = null;
                        this.qrContent = null;
                        this.qrCodeUpdatedAt = null;
                    }
                    const pairingCodeAgeMs = this.pairingCodeIssuedAt
                        ? Date.now() - new Date(this.pairingCodeIssuedAt).getTime()
                        : Number.POSITIVE_INFINITY;
                    const preservePairingCode = usePairingCode && this.pairingCode && pairingCodeAgeMs < 120000;
                    if (!preservePairingCode) {
                        this.pairingCode = null;
                        this.pairingCodeIssuedAt = null;
                        this.pairingPhoneTarget = null;
                    }""",
        1,
    )

if "Reusing active pairing code" not in im:
    old = """        const usePairingCode = !!options.pairingPhone;
        const isPairingRecovery = !!options._pairingRecovery;
        console.log(`[Instance ${this.id}] connect() called, mode: ${usePairingCode ? 'pairing' : 'qr'}, status: ${this.status}`);"""
    new = """        const usePairingCode = !!options.pairingPhone;
        const isPairingRecovery = !!options._pairingRecovery;

        if (usePairingCode && !isPairingRecovery) {
            const cleanTarget = String(options.pairingPhone || '').replace(/[^\\d]/g, '');
            if (
                this.pairingCode &&
                this.pairingPhoneTarget === cleanTarget &&
                this.pairingCodeIssuedAt &&
                Date.now() - new Date(this.pairingCodeIssuedAt).getTime() < 120000 &&
                (this.status === 'connecting' || this.connectInFlight)
            ) {
                console.log(`[Instance ${this.id}] Reusing active pairing code ${this.pairingCode}`);
                return;
            }
        }

        console.log(`[Instance ${this.id}] connect() called, mode: ${usePairingCode ? 'pairing' : 'qr'}, status: ${this.status}`);"""
    if old not in im:
        raise SystemExit("connect header missing")
    im = im.replace(old, new, 1)

if "pairingCodeIssuedAt: this.pairingCodeIssuedAt" not in im:
    im = im.replace(
        "            pairingCode: this.pairingCode,",
        "            pairingCode: this.pairingCode,\n            pairingCodeIssuedAt: this.pairingCodeIssuedAt,\n            pairingPhoneTarget: this.pairingPhoneTarget,",
        1,
    )

im_path.write_text(im)
print("instance-manager.js pairing stability patched")
