import { base64ByteLength, base64ToBytes, bytesToBase64 } from './base64';
import type { VfsEntry } from './types';

/**
 * A VFS entry carries either base64 (every binary) or, with `e: "utf8"`, the file's own text —
 * base64 would add a third to the weight of a couple of megabytes of engine JS (contract §4).
 * Everything that reads an entry goes through here so the two cases never diverge.
 */
export function isTextEntry(entry: VfsEntry): boolean {
    return entry.e === 'utf8';
}

export function entryBytes(entry: VfsEntry): Uint8Array {
    return isTextEntry(entry) ? new TextEncoder().encode(entry.d) : base64ToBytes(entry.d);
}

export function entryText(entry: VfsEntry): string {
    return isTextEntry(entry) ? entry.d : new TextDecoder('utf-8').decode(base64ToBytes(entry.d));
}

export function entryByteLength(entry: VfsEntry): number {
    if (!isTextEntry(entry)) return base64ByteLength(entry.d);
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
    if (isTextEntry(entry)) return new TextEncoder().encode(entry.d.slice(0, limit));
    const chars = Math.min(entry.d.length, Math.ceil((limit * 4) / 3));
    return base64ToBytes(entry.d.slice(0, chars - (chars % 4)));
}

export function entryDataUrl(entry: VfsEntry): string {
    return isTextEntry(entry)
        ? `data:${entry.t};charset=utf-8,${encodeURIComponent(entry.d)}`
        : `data:${entry.t};base64,${entry.d}`;
}

/** Swaps the payload, keeping `t` and `e` exactly as the build wrote them (contract §4). */
export function withBytes(entry: VfsEntry, bytes: Uint8Array): VfsEntry {
    return isTextEntry(entry)
        ? { ...entry, d: new TextDecoder('utf-8').decode(bytes) }
        : { ...entry, d: bytesToBase64(bytes) };
}
