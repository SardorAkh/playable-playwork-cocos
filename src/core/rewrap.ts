import JSZip from 'jszip';
import { base64ToBytes } from './base64';
import {
    MANIFEST_END,
    MANIFEST_PREFIX,
    MANIFEST_START,
    NEUTRAL_SDK_END,
    NEUTRAL_SDK_START,
    readAssignment,
    stripBlock,
} from './text';
import type { TunerManifest, WrapRecipe } from './types';

export function readManifest(html: string): TunerManifest | null {
    if (!html.includes(MANIFEST_START)) return null;
    return readAssignment<TunerManifest>(html, MANIFEST_PREFIX);
}

export function recipeFor(manifest: TunerManifest, networkId: string): WrapRecipe | null {
    return manifest.networks.find((recipe) => recipe.id === networkId) ?? null;
}

/**
 * Turns the network-neutral bundle into one network's document — the procedure from
 * tuner-integration.md §8.3, in order: strip both marked blocks, then insert the
 * recipe's head html (which must land before the tuning block) and its body tail.
 */
export function rewrapHtml(bundleHtml: string, recipe: WrapRecipe): string {
    let html = stripBlock(bundleHtml, NEUTRAL_SDK_START, NEUTRAL_SDK_END);
    html = stripBlock(html, MANIFEST_START, MANIFEST_END);

    const headOpen = /<head[^>]*>/i.exec(html);
    if (!headOpen || headOpen.index === undefined) throw new Error('bundle has no <head>');
    const insertAt = headOpen.index + headOpen[0].length;
    html = `${html.slice(0, insertAt)}\n${recipe.headHtml}\n${html.slice(insertAt)}`;

    if (recipe.bodyEndHtml) html = html.replace(/<\/body>/i, `${recipe.bodyEndHtml}\n</body>`);
    return html;
}

export type ZipEntry = { path: string; bytes: Uint8Array };

export function recipeZipEntries(recipe: WrapRecipe): ZipEntry[] {
    return recipe.zipEntries.map((entry) => ({
        path: entry.path,
        bytes: entry.encoding === 'base64' ? base64ToBytes(entry.content) : new TextEncoder().encode(entry.content),
    }));
}

export async function packRecipe(html: string, recipe: WrapRecipe, entries: ZipEntry[]): Promise<Blob> {
    if (recipe.format === 'html') return new Blob([html], { type: 'text/html' });
    const zip = new JSZip();
    zip.file('index.html', html);
    for (const entry of entries) zip.file(entry.path, entry.bytes);
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}
