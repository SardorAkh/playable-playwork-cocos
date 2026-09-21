import JSZip from 'jszip';
import { composeHtml, serialize } from './bundle';
import type { NetworkProfile } from './networks';
import { packRecipe, recipeFor, recipeZipEntries, rewrapHtml } from './rewrap';
import type { ZipEntry } from './rewrap';
import type { LoadedBuild, TuningValues, VfsMap } from './types';

export type Orientation = 'portrait' | 'landscape' | 'responsive';

export const ORIENTATIONS: Orientation[] = ['portrait', 'landscape', 'responsive'];

export const DEFAULT_ORIENTATION_SUFFIX: Record<Orientation, string> = {
    portrait: '_portrait',
    landscape: '_landscape',
    responsive: '_responsive',
};

export interface NetworkTarget {
    networkId: string;
    enabled: boolean;
    suffix: string;
    folder: string;
    /** Which loaded build feeds this folder — a network artifact, or a tuner bundle. */
    sourceId: string | null;
}

export interface OrientationTarget {
    orientation: Orientation;
    enabled: boolean;
    suffix: string;
}

export interface ExportSettings {
    baseName: string;
    networks: NetworkTarget[];
    orientations: OrientationTarget[];
}

export interface ExportSourceInfo {
    id: string;
    /** Network the file was built for; empty for a bundle, which fits every network. */
    networkId: string;
    format: 'html' | 'zip';
    bundle: boolean;
    /** Output format per network, taken from the bundle's manifest. */
    recipeFormats: Record<string, 'html' | 'zip'>;
}

export interface ExportItem {
    networkId: string;
    /** Null when no orientation was selected — the build is exported once, without a suffix. */
    orientation: Orientation | null;
    sourceId: string;
    path: string;
    /** A network artifact pointed at a different network's folder — its SDK will not match. */
    mismatched: boolean;
    /** Built by re-wrapping a tuner bundle rather than copying an artifact. */
    rewrapped: boolean;
}

/** Trailing network/orientation markers a previous build left in the file name. */
const KNOWN_TAIL =
    /([-_](AL|UNITY|IS|FB|LIFTOFF|MINTEGRAL|GOOGLE|TIKTOK|TUNER|portrait|landscape|responsive|tuned))+$/i;

export function suggestBaseName(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    const stem = dot === -1 ? fileName : fileName.slice(0, dot);
    return stem.replace(KNOWN_TAIL, '') || stem;
}

function sanitize(value: string, fallback: string): string {
    const clean = value.replace(/[\\/:*?"<>|]+/g, '').trim();
    return clean || fallback;
}

export function canFeed(source: ExportSourceInfo, network: NetworkProfile): boolean {
    return source.bundle || source.format === network.format;
}

export function targetFormat(source: ExportSourceInfo, network: NetworkProfile): 'html' | 'zip' {
    if (!source.bundle) return source.format;
    return source.recipeFormats[network.id] ?? network.format;
}

export function planExport(
    settings: ExportSettings,
    networks: NetworkProfile[],
    sources: ExportSourceInfo[],
): ExportItem[] {
    const orientations = settings.orientations.filter((item) => item.enabled);
    const items: ExportItem[] = [];

    for (const target of settings.networks) {
        if (!target.enabled || !target.sourceId) continue;
        const profile = networks.find((network) => network.id === target.networkId);
        const source = sources.find((item) => item.id === target.sourceId);
        if (!profile || !source) continue;

        const base = sanitize(settings.baseName, 'playable');
        const folder = sanitize(target.folder, profile.folder);
        const extension = targetFormat(source, profile);
        const mismatched = !source.bundle && source.networkId !== target.networkId;

        for (const orientation of orientations.length > 0 ? orientations : [null]) {
            const tail = orientation ? sanitize(orientation.suffix, '') : '';
            items.push({
                networkId: target.networkId,
                orientation: orientation ? orientation.orientation : null,
                sourceId: target.sourceId,
                path: `${folder}/${base}${sanitize(target.suffix, '')}${tail}.${extension}`,
                mismatched,
                rewrapped: source.bundle,
            });
        }
    }
    return items;
}

/**
 * Mintegral reads the orientation from config.json rather than the document, so that entry is
 * rewritten per orientation. Everywhere else orientation lives in the campaign settings and the
 * file-name suffix is what tells the files apart.
 */
function orientedEntries(entries: ZipEntry[], orientation: Orientation | null): ZipEntry[] {
    if (!orientation || orientation === 'responsive') return entries;
    const index = entries.findIndex((entry) => entry.path === 'config.json');
    if (index === -1) return entries;
    try {
        const config = JSON.parse(new TextDecoder('utf-8').decode(entries[index].bytes)) as Record<string, unknown>;
        if (!('orientation' in config)) return entries;
        config.orientation = orientation;
        const next = [...entries];
        next[index] = { path: 'config.json', bytes: new TextEncoder().encode(JSON.stringify(config, null, 2)) };
        return next;
    } catch {
        return entries;
    }
}

export interface ExportSource {
    id: string;
    build: LoadedBuild;
}

/** Produces one target's bytes: either a re-wrapped bundle or the artifact as loaded. */
export async function buildArtifact(
    build: LoadedBuild,
    networkId: string,
    orientation: Orientation | null,
    values: TuningValues,
    overrides: VfsMap,
): Promise<{ blob: Blob; html: string; maxBytes: number | null }> {
    const tuned = composeHtml(build, values, overrides);

    if (build.manifest) {
        const recipe = recipeFor(build.manifest, networkId);
        if (!recipe) throw new Error(`bundle has no recipe for "${networkId}"`);
        const html = rewrapHtml(tuned, recipe);
        const entries = orientedEntries(recipeZipEntries(recipe), orientation);
        return { blob: await packRecipe(html, recipe, entries), html, maxBytes: recipe.maxSizeBytes };
    }

    const extras = orientedEntries(build.extras, orientation);
    return { blob: await serialize({ ...build, extras }, tuned), html: tuned, maxBytes: null };
}

export async function packExport(
    items: ExportItem[],
    sources: ExportSource[],
    values: TuningValues,
    overrides: VfsMap,
): Promise<{ blob: Blob; sizes: Map<string, number> }> {
    const zip = new JSZip();
    const sizes = new Map<string, number>();
    const cache = new Map<string, Blob>();

    for (const item of items) {
        const source = sources.find((entry) => entry.id === item.sourceId);
        if (!source) continue;
        const cacheKey = `${item.sourceId}:${item.networkId}:${item.orientation ?? 'none'}`;
        let file = cache.get(cacheKey);
        if (!file) {
            file = (await buildArtifact(source.build, item.networkId, item.orientation, values, overrides)).blob;
            cache.set(cacheKey, file);
        }
        zip.file(item.path, file);
        sizes.set(item.path, file.size);
    }

    const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
    });
    return { blob, sizes };
}
