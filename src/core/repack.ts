import pakoInflateSource from 'pako/dist/pako_inflate.min.js?raw';
import { deflateRaw } from 'pako';
import { bytesToBase64 } from './base64';
import { FS_PREFIX, FS_TERMINATOR } from './text';

/**
 * Builds made before the payload went base64 throughout keep their text assets
 * in the document as their own source, which is what AppLovin rejects — "the
 * html file contains assets that are not base64 or base122 encoded". The
 * producer's work lives in those files, though: tuned values, swapped assets,
 * sometimes weeks of it. Re-encoding the entries in place is not an option,
 * because the build carries its own VFS runtime and that runtime only knows the
 * two encodings it was written for.
 *
 * So the payload is replaced by one deflated base64 blob, and a bootstrap put
 * in front of the runtime inflates it back into exactly the object the runtime
 * has always read — raw text entries and all. The runtime is untouched, so
 * there is nothing in it left to break, and the document carries nothing but
 * base64. It comes out about the weight a rebuild would produce.
 *
 * What this cannot fix is anything baked into that runtime rather than the
 * payload: a build from before 2026-09-28 fetches its @font-face files over the
 * network whatever the payload looks like. `lacksFontInterception` reports it.
 */

/** The marker the builder's current encoder leaves on a compressed entry. */
const PACKED_MARKER = '"e":"z"';

/** Present only in runtimes that rewrite injected @font-face url() to data uris. */
const FONT_INTERCEPTION = 'inlineStyleNode';

interface PayloadRegion {
    /** Where the enclosing <script> tag starts. */
    tagStart: number;
    /** The payload's JSON text, exactly as the document carries it. */
    json: string;
    /** First index after the assignment's `;</script>`. */
    end: number;
}

function payloadRegion(html: string): PayloadRegion | null {
    const prefix = html.indexOf(FS_PREFIX);
    if (prefix === -1) return null;
    const from = prefix + FS_PREFIX.length;
    const terminator = html.indexOf(FS_TERMINATOR, from);
    if (terminator === -1) return null;
    const tagStart = html.lastIndexOf('<script', prefix);
    if (tagStart === -1) return null;
    return { tagStart, json: html.slice(from, terminator), end: terminator + FS_TERMINATOR.length };
}

/**
 * Whether this document is one the repack applies to: it has a payload, and
 * that payload predates the builder's own compression. A modern build is left
 * alone — its entries are already deflated individually, and compressing the
 * whole thing again would only cost boot time.
 */
export function isLegacyPayload(html: string): boolean {
    const region = payloadRegion(html);
    return region !== null && !region.json.includes(PACKED_MARKER);
}

/** Whether any asset in the document is held as something other than base64. */
export function hasUnencodedPayload(html: string): boolean {
    const region = payloadRegion(html);
    if (!region) return false;
    return /"e":"(?!z")[^"]*"/.test(region.json);
}

/**
 * Whether the build's own runtime leaves runtime-injected @font-face alone. Such
 * a build asks the network for its fonts, which every network reading this list
 * forbids, and no amount of repacking changes that — only a rebuild does.
 */
export function lacksFontInterception(html: string): boolean {
    return payloadRegion(html) !== null && !html.includes(FONT_INTERCEPTION);
}

/**
 * pako's inflate-only bundle, inlined so the exported file carries its own
 * decoder. It is a UMD bundle: with no module system around it, it leaves
 * itself on `window.pako`, so the global is put back the way it was found in
 * case the game ships its own copy.
 */
function bootstrapScript(blob: string): string {
    return `<script>
(function() {
    var previous = window.pako;
    var had = Object.prototype.hasOwnProperty.call(window, 'pako');
${pakoInflateSource}
    window.__PLAYABLE_TUNER_INFLATE__ = window.pako.inflateRaw;
    if (had) { window.pako = previous; } else { try { delete window.pako; } catch (ignored) { window.pako = undefined; } }
})();
</script>
<script>window.__PLAYABLE_FS__ = (function() {
    var packed = "${blob}";
    var binary = atob(packed);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return JSON.parse(window.__PLAYABLE_TUNER_INFLATE__(bytes, { to: 'string' }));
})();</script>`;
}

/**
 * Returns the document with its payload compressed, or the document unchanged
 * when there is nothing to gain — a payload the builder already compressed, or
 * one small enough that the inflater costs more than the compression saves.
 */
export function repackLegacyPayload(html: string): string {
    const region = payloadRegion(html);
    if (!region || region.json.includes(PACKED_MARKER)) return html;

    const packed = bytesToBase64(deflateRaw(new TextEncoder().encode(region.json), { level: 9 }));
    // base64 cannot spell `</script` or `<!--`, so the blob needs no escaping.
    const repacked = html.slice(0, region.tagStart) + bootstrapScript(packed) + html.slice(region.end);
    return repacked.length < html.length ? repacked : html;
}
