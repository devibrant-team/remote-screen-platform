"use strict";
// src/utils/mediaStorage/assetKey.ts
// Deterministic asset key generation & URL normalization.
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMediaUrl = normalizeMediaUrl;
exports.sha256Utf8 = sha256Utf8;
exports.generateAssetKey = generateAssetKey;
exports.extractExtension = extractExtension;
/**
 * Normalizes media URL by stripping cachebusters (e.g. cb=...) and trailing query artifacts.
 */
function normalizeMediaUrl(url) {
    if (!url)
        return "";
    return url
        .trim()
        .replace(/([?&])cb=\d+(&|$)/, (_m, p1, p2) => (p2 ? p1 : ""))
        .replace(/\?&$/, "?")
        .replace(/\?$/, "");
}
/**
 * Pure TypeScript UTF-8 compliant SHA-256 implementation.
 * Produces identical output to standard crypto.createHash("sha256") without external native dependencies.
 */
function sha256Utf8(str) {
    function rightRotate(value, amount) {
        return (value >>> amount) | (value << (32 - amount));
    }
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c < 0x80) {
            bytes.push(c);
        }
        else if (c < 0x800) {
            bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        }
        else if (c < 0xd800 || c >= 0xe000) {
            bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        }
        else {
            i++;
            c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
            bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        }
    }
    const bitLength = bytes.length * 8;
    const hash = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    const k = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) {
        bytes.push(0x00);
    }
    const words = [];
    for (let i = 0; i < bytes.length; i += 4) {
        words.push((bytes[i] << 24) |
            (bytes[i + 1] << 16) |
            (bytes[i + 2] << 8) |
            bytes[i + 3]);
    }
    words.push(Math.floor(bitLength / 0x100000000));
    words.push(bitLength & 0xffffffff);
    for (let j = 0; j < words.length; j += 16) {
        const w = words.slice(j, j + 16);
        let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
        let e = hash[4], f = hash[5], g = hash[6], h = hash[7];
        for (let i = 0; i < 64; i++) {
            if (i >= 16) {
                const w15 = w[i - 15], w2 = w[i - 2];
                const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
                const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
                w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
            }
            const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + k[i] + w[i]) | 0;
            const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) | 0;
            h = g;
            g = f;
            f = e;
            e = (d + temp1) | 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) | 0;
        }
        hash[0] = (hash[0] + a) | 0;
        hash[1] = (hash[1] + b) | 0;
        hash[2] = (hash[2] + c) | 0;
        hash[3] = (hash[3] + d) | 0;
        hash[4] = (hash[4] + e) | 0;
        hash[5] = (hash[5] + f) | 0;
        hash[6] = (hash[6] + g) | 0;
        hash[7] = (hash[7] + h) | 0;
    }
    let result = "";
    for (let i = 0; i < 8; i++) {
        result += (hash[i] >>> 0).toString(16).padStart(8, "0");
    }
    return result;
}
/**
 * Generates a stable, collision-resistant asset key from the normalized URL.
 * URL hashing is used ONLY for namespace / stable asset key generation, NOT content integrity.
 */
function generateAssetKey(url) {
    const normalized = normalizeMediaUrl(url);
    return sha256Utf8(normalized);
}
/**
 * Safely extracts file extension from URL pathname.
 */
function extractExtension(url, fallback = "") {
    try {
        const parsed = new URL(url);
        const pathname = parsed.pathname;
        const lastDot = pathname.lastIndexOf(".");
        if (lastDot > 0 && lastDot < pathname.length - 1) {
            const ext = pathname.slice(lastDot).toLowerCase();
            // Keep only standard alphanumeric extensions up to 5 chars (e.g. .mp4, .jpeg, .png, .webp)
            if (/^\.[a-z0-9]{1,5}$/.test(ext)) {
                return ext;
            }
        }
    }
    catch {
        // If not a full URL, attempt simple regex on string
        const match = url.match(/\.([a-z0-9]{1,5})(?:[?#]|$)/i);
        if (match)
            return `.${match[1].toLowerCase()}`;
    }
    return fallback;
}
