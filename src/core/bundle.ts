import JSZip from 'jszip';
import {
    ASSETS_PREFIX,
    SCHEMA_PREFIX,
    VALUES_PREFIX,
    isPlayableBuild,
    readAssignment,
    readVfs,
    writeAssignment,
    writeVfs,
} from './text';
import { readManifest } from './rewrap';
import type { LoadedBuild, TuningAssets, TuningSchema, TuningValues, VfsMap } from './types';

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

async function looksLikeZip(file: Blob): Promise<boolean> {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return ZIP_MAGIC.every((byte, index) => head[index] === byte);
}

export async function loadBuild(file: File): Promise<LoadedBuild> {
    const isZip = await looksLikeZip(file);
    const notes: string[] = [];
    let html: string;
    const extras: LoadedBuild['extras'] = [];

    if (isZip) {
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const index = zip.file('index.html');
        if (!index) throw new Error('zip has no index.html');
        html = await index.async('string');
        for (const entry of Object.values(zip.files)) {
            if (entry.dir || entry.name === 'index.html') continue;
            extras.push({ path: entry.name, bytes: await entry.async('uint8array') });
        }
    } else {
        html = await file.text();
    }

    if (!isPlayableBuild(html)) {
        notes.push('not-a-build');
    }

    const schema = readAssignment<TuningSchema>(html, SCHEMA_PREFIX);
    const values = readAssignment<TuningValues>(html, VALUES_PREFIX);
    const assets = readAssignment<TuningAssets>(html, ASSETS_PREFIX);
    const vfs = readVfs(html);
    const manifest = readManifest(html);

    if (manifest) notes.push('bundle');
    if (!schema) notes.push('no-schema');
    if (!vfs) notes.push('no-vfs');

    return {
        kind: isZip ? 'zip' : 'html',
        fileName: file.name,
        sourceBytes: file.size,
        html,
        extras,
        schema,
        values: values ?? {},
        assets: assets ?? {},
        vfs,
        hasTuningBlock: values !== null,
        manifest,
        notes,
    };
}

/** Re-applies current values and swapped assets onto the pristine html. */
export function composeHtml(build: LoadedBuild, values: TuningValues, vfsOverrides: VfsMap): string {
    let html = build.html;
    if (build.hasTuningBlock) html = writeAssignment(html, VALUES_PREFIX, values);
    const overridden = Object.keys(vfsOverrides);
    if (overridden.length > 0 && build.vfs) {
        html = writeVfs(html, { ...build.vfs, ...vfsOverrides });
    }
    return html;
}

export async function serialize(build: LoadedBuild, html: string): Promise<Blob> {
    if (build.kind === 'html') return new Blob([html], { type: 'text/html' });
    const zip = new JSZip();
    zip.file('index.html', html);
    for (const extra of build.extras) zip.file(extra.path, extra.bytes);
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

export function exportFileName(build: LoadedBuild): string {
    const dot = build.fileName.lastIndexOf('.');
    const base = dot === -1 ? build.fileName : build.fileName.slice(0, dot);
    return `${base}_tuned.${build.kind}`;
}
