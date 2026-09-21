import type { VfsMap } from './types';

export const TUNING_START = '/*__PLAYABLE_TUNING_START__*/';
export const TUNING_END = '/*__PLAYABLE_TUNING_END__*/';
export const VALUES_PREFIX = 'window.__TUNING__ = ';
export const SCHEMA_PREFIX = 'window.__TUNING_SCHEMA__ = ';
export const ASSETS_PREFIX = 'window.__TUNING_ASSETS__ = ';
export const FS_PREFIX = 'window.__PLAYABLE_FS__ = ';
export const MANIFEST_PREFIX = 'window.__PLAYABLE_MANIFEST__ = ';
export const NEUTRAL_SDK_START = '<!--__PLAYABLE_NEUTRAL_SDK_START__-->';
export const NEUTRAL_SDK_END = '<!--__PLAYABLE_NEUTRAL_SDK_END__-->';
export const MANIFEST_START = '<!--__PLAYABLE_MANIFEST_START__-->';
export const MANIFEST_END = '<!--__PLAYABLE_MANIFEST_END__-->';
export const FS_TERMINATOR = ';</script>';

/** `</script` inside a JSON string literal must be escaped so the browser does not close the tag. */
export function escapeForScript(json: string): string {
    return json.replace(/<\/script/gi, '<\\/script');
}

export function unescapeFromScript(json: string): string {
    return json.replace(/<\\\/script/gi, '</script');
}

function assignmentBounds(html: string, prefix: string): { from: number; to: number } | null {
    const start = html.indexOf(prefix);
    if (start === -1) return null;
    const from = start + prefix.length;
    const to = html.indexOf(';\n', from);
    if (to === -1) return null;
    return { from, to };
}

export function readAssignment<T>(html: string, prefix: string): T | null {
    const bounds = assignmentBounds(html, prefix);
    if (!bounds) return null;
    try {
        return JSON.parse(unescapeFromScript(html.slice(bounds.from, bounds.to))) as T;
    } catch {
        return null;
    }
}

export function writeAssignment(html: string, prefix: string, value: unknown): string {
    const bounds = assignmentBounds(html, prefix);
    if (!bounds) return html;
    const json = escapeForScript(JSON.stringify(value));
    return html.slice(0, bounds.from) + json + html.slice(bounds.to);
}

function vfsBounds(html: string): { from: number; to: number } | null {
    const start = html.indexOf(FS_PREFIX);
    if (start === -1) return null;
    const from = start + FS_PREFIX.length;
    const to = html.indexOf(FS_TERMINATOR, from);
    if (to === -1) return null;
    return { from, to };
}

export function readVfs(html: string): VfsMap | null {
    const bounds = vfsBounds(html);
    if (!bounds) return null;
    try {
        return JSON.parse(unescapeFromScript(html.slice(bounds.from, bounds.to))) as VfsMap;
    } catch {
        return null;
    }
}

export function writeVfs(html: string, vfs: VfsMap): string {
    const bounds = vfsBounds(html);
    if (!bounds) return html;
    return html.slice(0, bounds.from) + escapeForScript(JSON.stringify(vfs)) + html.slice(bounds.to);
}

/** The `<script id="playable-tuning">` payload — the only user-editable text region. */
export function tuningBlock(html: string): string | null {
    const start = html.indexOf(TUNING_START);
    if (start === -1) return null;
    const end = html.indexOf(TUNING_END, start);
    if (end === -1) return null;
    return html.slice(start, end + TUNING_END.length);
}

export function hasIntactMarkers(html: string): boolean {
    const starts = html.split(TUNING_START).length - 1;
    const ends = html.split(TUNING_END).length - 1;
    return starts === 1 && ends === 1 && html.indexOf(TUNING_START) < html.indexOf(TUNING_END);
}

export function isPlayableBuild(html: string): boolean {
    return html.includes('id="playable-tuning"') || html.includes(FS_PREFIX) || html.includes('window.playable');
}

/** Removes a marked block together with its markers (tuner-integration.md §8.3). */
export function stripBlock(html: string, start: string, end: string): string {
    const from = html.indexOf(start);
    const to = html.indexOf(end);
    if (from === -1 || to === -1) return html;
    return html.slice(0, from) + html.slice(to + end.length);
}

export function isTunerBundle(html: string): boolean {
    return html.includes(MANIFEST_START);
}

export function collectUrls(text: string): Set<string> {
    const found = new Set<string>();
    const pattern = /https?:\/\/[^\s'"<>\\)]+/gi;
    for (const match of text.matchAll(pattern)) found.add(match[0]);
    return found;
}
