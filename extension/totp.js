// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Danial Hatami
// RFC 6238 TOTP (SHA-1, 30s, 6 digits) -- what Google Authenticator / FortiToken use.
import GLib from 'gi://GLib';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function b32decode(str) {
    const out = [];
    let bits = 0, val = 0;
    for (const ch of str.replace(/[\s=-]/g, '').toUpperCase()) {
        const i = B32.indexOf(ch);
        if (i < 0)
            throw new Error('OTP secret is not valid base32');
        val = ((val << 5) | i) & 0xfff;
        bits += 5;
        if (bits >= 8) {
            out.push((val >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return Uint8Array.from(out);
}

export function totp(secret, nowMs = Date.now()) {
    const step = Math.floor(nowMs / 30000);
    const msg = new Uint8Array(8);
    const dv = new DataView(msg.buffer);
    dv.setUint32(0, Math.floor(step / 2 ** 32));
    dv.setUint32(4, step >>> 0);

    const hex = GLib.compute_hmac_for_bytes(
        GLib.ChecksumType.SHA1, new GLib.Bytes(b32decode(secret)), new GLib.Bytes(msg));
    const h = hex.match(/../g).map(x => parseInt(x, 16));
    const o = h[19] & 0xf;
    const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6;
    return String(code).padStart(6, '0');
}
