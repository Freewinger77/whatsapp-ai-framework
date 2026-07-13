from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

old = """        const options = {};
        if (req.body.pairingPhone) {
            options.pairingPhone = req.body.pairingPhone;
        }"""

new = """        const options = {};
        const pairingPhone = req.body.pairingPhone || req.body.phoneNumber || req.body.phone;
        if (pairingPhone) {
            options.pairingPhone = String(pairingPhone).replace(/^\\+/, '').replace(/[\\s\\-\\(\\)]/g, '');
        }"""

if new in text:
    print('connect alias already patched')
elif old not in text:
    raise SystemExit('connect block not found')
else:
    path.write_text(text.replace(old, new, 1))
    print('connect phone aliases patched')
