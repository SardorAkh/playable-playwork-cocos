/**
 * Header-only media probes. Everything here reads a few dozen bytes from the front of a file —
 * the tuner only needs the numbers a producer checks at a glance (resolution, sample rate,
 * bitrate), and decoding multi-megabyte assets for that would stall the panel.
 */
export interface MediaMeta {
    format?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    sampleRate?: number;
    channels?: number;
    bitrateKbps?: number;
}

/** Enough for every header below, including a modest ID3v2 tag. */
export const PROBE_BYTES = 4096;

const MPEG_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MPEG_RATES_V1 = [44100, 48000, 32000, 0];
const MPEG_RATES_V2 = [22050, 24000, 16000, 0];
const MPEG_RATES_V25 = [11025, 12000, 8000, 0];

function ascii(bytes: Uint8Array, at: number, length: number): string {
    let text = '';
    for (let i = 0; i < length; i += 1) text += String.fromCharCode(bytes[at + i] ?? 0);
    return text;
}

const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32le = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

function png(bytes: Uint8Array): MediaMeta | null {
    if (ascii(bytes, 1, 3) !== 'PNG') return null;
    return { format: 'PNG', width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

/** Walks the JPEG marker chain to the frame header that carries the real dimensions. */
function jpeg(bytes: Uint8Array): MediaMeta | null {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let at = 2;
    while (at + 9 <= bytes.length) {
        if (bytes[at] !== 0xff) {
            at += 1;
            continue;
        }
        const marker = bytes[at + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { format: 'JPEG', height: u16be(bytes, at + 5), width: u16be(bytes, at + 7) };
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            at += 2;
            continue;
        }
        at += 2 + u16be(bytes, at + 2);
    }
    return { format: 'JPEG' };
}

function gif(bytes: Uint8Array): MediaMeta | null {
    if (ascii(bytes, 0, 3) !== 'GIF') return null;
    return { format: 'GIF', width: u16le(bytes, 6), height: u16le(bytes, 8) };
}

function webp(bytes: Uint8Array): MediaMeta | null {
    if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8X') return { format: 'WEBP', width: 1 + readU24le(bytes, 24), height: 1 + readU24le(bytes, 27) };
    if (chunk === 'VP8 ') return { format: 'WEBP', width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    if (chunk === 'VP8L') {
        const bits = u32le(bytes, 21);
        return { format: 'WEBP', width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    return { format: 'WEBP' };
}

function readU24le(bytes: Uint8Array, at: number): number {
    return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
}

function bmp(bytes: Uint8Array): MediaMeta | null {
    if (ascii(bytes, 0, 2) !== 'BM') return null;
    return { format: 'BMP', width: u32le(bytes, 18), height: Math.abs(u32le(bytes, 22) | 0) };
}

function svg(bytes: Uint8Array, mime: string): MediaMeta | null {
    if (!mime.includes('svg')) return null;
    const head = ascii(bytes, 0, Math.min(bytes.length, 1024));
    const width = /width\s*=\s*["']?(\d+(?:\.\d+)?)/i.exec(head);
    const height = /height\s*=\s*["']?(\d+(?:\.\d+)?)/i.exec(head);
    const viewBox = /viewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/i.exec(head);
    if (width && height) return { format: 'SVG', width: Math.round(Number(width[1])), height: Math.round(Number(height[1])) };
    if (viewBox) return { format: 'SVG', width: Math.round(Number(viewBox[1])), height: Math.round(Number(viewBox[2])) };
    return { format: 'SVG' };
}

/** RIFF/WAVE: the fmt chunk carries everything, and duration follows from the data chunk. */
function wav(bytes: Uint8Array, totalBytes: number): MediaMeta | null {
    if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return null;
    const meta: MediaMeta = { format: 'WAV' };
    let at = 12;
    while (at + 8 <= bytes.length) {
        const id = ascii(bytes, at, 4);
        const size = u32le(bytes, at + 4);
        if (id === 'fmt ') {
            meta.channels = u16le(bytes, at + 10);
            meta.sampleRate = u32le(bytes, at + 12);
            const byteRate = u32le(bytes, at + 16);
            if (byteRate > 0) {
                meta.bitrateKbps = Math.round((byteRate * 8) / 1000);
                // The data chunk may sit past the probe window; the file size is the safe fallback.
                const dataSize = findWavDataSize(bytes, totalBytes);
                meta.durationMs = Math.round((dataSize / byteRate) * 1000);
            }
        }
        if (id === 'data') break;
        at += 8 + size + (size % 2);
    }
    return meta;
}

function findWavDataSize(bytes: Uint8Array, totalBytes: number): number {
    let at = 12;
    while (at + 8 <= bytes.length) {
        const id = ascii(bytes, at, 4);
        const size = u32le(bytes, at + 4);
        if (id === 'data') return Math.min(size, totalBytes - at - 8);
        at += 8 + size + (size % 2);
    }
    return Math.max(0, totalBytes - 44);
}

function mp3(bytes: Uint8Array, totalBytes: number): MediaMeta | null {
    let at = 0;
    if (ascii(bytes, 0, 3) === 'ID3') {
        // Syncsafe integer: seven bits per byte.
        const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
        at = 10 + size;
    } else if (!(bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
        return null;
    }

    for (let i = at; i + 4 <= bytes.length; i += 1) {
        if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
        const versionBits = (bytes[i + 1] >> 3) & 0x03;
        const layerBits = (bytes[i + 1] >> 1) & 0x03;
        if (versionBits === 1 || layerBits === 0) continue;
        const bitrateIndex = (bytes[i + 2] >> 4) & 0x0f;
        const rateIndex = (bytes[i + 2] >> 2) & 0x03;
        const table = versionBits === 3 ? MPEG_BITRATES_V1_L3 : MPEG_BITRATES_V2_L3;
        const rates = versionBits === 3 ? MPEG_RATES_V1 : versionBits === 2 ? MPEG_RATES_V2 : MPEG_RATES_V25;
        const bitrate = table[bitrateIndex];
        const sampleRate = rates[rateIndex];
        if (!bitrate || !sampleRate) continue;
        const channels = ((bytes[i + 3] >> 6) & 0x03) === 3 ? 1 : 2;
        return {
            format: 'MP3',
            bitrateKbps: bitrate,
            sampleRate,
            channels,
            // Constant-bitrate estimate; a VBR file lands close enough to be useful.
            durationMs: Math.round(((totalBytes - at) * 8) / bitrate),
        };
    }
    return { format: 'MP3' };
}

function ogg(bytes: Uint8Array): MediaMeta | null {
    if (ascii(bytes, 0, 4) !== 'OggS') return null;
    const head = ascii(bytes, 28, 8);
    if (head.startsWith('OpusHead')) {
        return { format: 'OPUS', channels: bytes[37], sampleRate: u32le(bytes, 40) };
    }
    if (head.startsWith('vorbis')) {
        return { format: 'VORBIS', channels: bytes[39], sampleRate: u32le(bytes, 40) };
    }
    return { format: 'OGG' };
}

function m4a(bytes: Uint8Array): MediaMeta | null {
    if (ascii(bytes, 4, 4) !== 'ftyp') return null;
    return { format: ascii(bytes, 8, 4).trim().toUpperCase() || 'MP4' };
}

/**
 * `bytes` only has to be the first PROBE_BYTES of the file; `totalBytes` is its real length,
 * which is what duration estimates need.
 */
export function probeMedia(bytes: Uint8Array, totalBytes: number, mime = ''): MediaMeta {
    const probes = [
        () => png(bytes),
        () => jpeg(bytes),
        () => gif(bytes),
        () => webp(bytes),
        () => bmp(bytes),
        () => svg(bytes, mime),
        () => wav(bytes, totalBytes),
        () => mp3(bytes, totalBytes),
        () => ogg(bytes),
        () => m4a(bytes),
    ];
    for (const probe of probes) {
        const meta = probe();
        if (meta) return meta;
    }
    return {};
}

export function formatDuration(ms: number): string {
    const totalSeconds = ms / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds - minutes * 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds.toFixed(1)}`;
}
