import pako from 'pako';
import { base64ByteLength, base64ToBytes, bytesToBase64 } from './base64';
import type { VfsEntry } from './types';

/**
 * A VFS entry's payload is base64 from end to end, because the networks read
 * the document: AppLovin rejects a creative whose html holds an asset in any
 * other encoding — "contains assets that are not base64 or base122 encoded" —
 * however well it runs. `e: "z"` says those bytes are raw deflate, which is
 * how a couple of megabytes of engine source pay the base64 third back and
 * then some (contract §4).
 *
 * Builds made before that stored text as its own source under `e: "utf8"`.
 * They are still read here, and `isUnencodedEntry` is what lets the tuner tell
 * the producer that their payload is the kind that gets rejected.
 */
export function isPackedEntry(entry: VfsEntry): boolean {
    return entry.e === 'z';
}

export function isUnencodedEntry(entry: VfsEntry): boolean {
    return entry.e === 'utf8';
}

/**
 * Inflating the engine source on every size readout and every validation pass
 * would make the panel crawl, so each entry is decoded once. The map is weak:
 * reverting a swap drops the override and the bytes go with it.
 */
const decoded = new WeakMap<VfsEntry, Uint8Array>();

export function entryBytes(entry: VfsEntry): Uint8Array {
    const cached = decoded.get(entry);
    if (cached) return cached;
    const bytes = isUnencodedEntry(entry)
        ? new TextEncoder().encode(entry.d)
        : isPackedEntry(entry)
          ? pako.inflateRaw(base64ToBytes(entry.d))
          : base64ToBytes(entry.d);
    decoded.set(entry, bytes);
    return bytes;
}

export function entryText(entry: VfsEntry): string {
    return isUnencodedEntry(entry) ? entry.d : new TextDecoder('utf-8').decode(entryBytes(entry));
}

export function entryByteLength(entry: VfsEntry): number {
    // What the asset weighs as a file, which is the number a producer reads —
    // not what it costs inside the payload.
    if (isPackedEntry(entry)) return entryBytes(entry).length;
    if (!isUnencodedEntry(entry)) return base64ByteLength(entry.d);
    // Only count the bytes; encoding a multi-megabyte string just to measure it is wasteful.
    let bytes = 0;
    for (const char of entry.d) {
        const code = char.codePointAt(0)!;
        bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    }
    return bytes;
}

/** First bytes only — enough for every media header probe. */
export function entryHead(entry: VfsEntry, limit: number): Uint8Array {
    if (isUnencodedEntry(entry)) return new TextEncoder().encode(entry.d.slice(0, limit));
    // Deflate has no seekable front: the whole entry is inflated, once, and
    // every later probe reads its head out of the cache.
    if (isPackedEntry(entry)) return entryBytes(entry).subarray(0, limit);
    const chars = Math.min(entry.d.length, Math.ceil((limit * 4) / 3));
    return base64ToBytes(entry.d.slice(0, chars - (chars % 4)));
}

export function entryDataUrl(entry: VfsEntry): string {
    if (!entry.e) return `data:${entry.t};base64,${entry.d}`;
    return `data:${entry.t};base64,${bytesToBase64(entryBytes(entry))}`;
}

/** Swaps the payload, keeping `t` and `e` exactly as the build wrote them (contract §4). */
export function withBytes(entry: VfsEntry, bytes: Uint8Array): VfsEntry {
    if (isUnencodedEntry(entry)) return { ...entry, d: new TextDecoder('utf-8').decode(bytes) };
    if (isPackedEntry(entry)) return { ...entry, d: bytesToBase64(pako.deflateRaw(bytes, { level: 9 })) };
    return { ...entry, d: bytesToBase64(bytes) };
}
