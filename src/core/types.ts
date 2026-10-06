export type TuningParamType = 'number' | 'boolean' | 'string' | 'select' | 'color' | 'image' | 'audio' | 'video';

export interface TuningGroup {
    id: string;
    label?: string;
    description?: string;
    collapsed?: boolean;
}

export interface TuningParam {
    key: string;
    type: TuningParamType;
    /** Presentational category — always filled in a freshly built file (tuning-groups.md §2). */
    group?: string;
    label?: string;
    default?: unknown;
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
    live?: boolean;
    asset?: string;
}

export interface TuningSchema {
    /** Always present in a freshly built file; older builds simply omit it. */
    groups?: TuningGroup[];
    params: TuningParam[];
}

export interface TuningAssetRef {
    file: string;
    mime: string;
    /** Image slots only: the footprint the original occupied, baked into the scene at build time. */
    fit?: AssetFit;
}

/**
 * The runtime redraws a replacement onto a rawWidth x rawHeight canvas, fitting it into the
 * x/y/width/height area. Its presence is what makes replacement size irrelevant (contract §4).
 */
export interface AssetFit {
    rawWidth: number;
    rawHeight: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

export type TuningValues = Record<string, unknown>;
export type TuningAssets = Record<string, TuningAssetRef>;

export interface VfsEntry {
    t: string;
    /** base64 by default; the raw file text when `e` says utf8. */
    d: string;
    e?: string;
}

export type VfsMap = Record<string, VfsEntry>;

export interface WrapRecipe {
    id: string;
    displayName: string;
    shortName: string;
    format: 'html' | 'zip';
    maxSizeBytes: number;
    fileName: string;
    /** Whole SDK layer of the network, inserted right after <head>. */
    headHtml: string;
    bodyEndHtml: string;
    zipEntries: { path: string; content: string; encoding: 'utf-8' | 'base64' }[];
}

export interface TunerManifest {
    builder: string;
    contract: number;
    generatedAt: string;
    app: string;
    version: string;
    date: string;
    language: string;
    orientation: string;
    storeUrls: { android: string; ios: string };
    networks: WrapRecipe[];
}

export type SourceKind = 'html' | 'zip';

/** Everything parsed out of an uploaded build. `html` stays pristine — edits are re-applied on demand. */
export interface LoadedBuild {
    kind: SourceKind;
    fileName: string;
    /** Original bytes size of the uploaded file. */
    sourceBytes: number;
    /** Pristine index.html of the build. */
    html: string;
    /** Extra zip entries (everything but index.html), kept byte-identical. */
    extras: { path: string; bytes: Uint8Array }[];
    schema: TuningSchema | null;
    values: TuningValues;
    assets: TuningAssets;
    vfs: VfsMap | null;
    hasTuningBlock: boolean;
    /** Present only in a tuner bundle — carries a wrap recipe for every network (§8). */
    manifest: TunerManifest | null;
    /** Message keys for things worth telling the user about the file itself. */
    notes: string[];
}

export interface ValidationIssue {
    severity: 'error' | 'warning';
    /** Message key — the UI turns it into localized text. */
    code: string;
    params?: Record<string, string | number>;
}

/**
 * What a build answers when the tuner asks it to check a value.
 *
 * Optional: a build defines `window.__tuningCheck__(key, value)` only if some
 * of its parameters have rules the tuner could not know -- a level
 * description, a config blob. `supported` is false when it defines nothing.
 */
export interface ValueCheck {
    key: string;
    supported: boolean;
    ok: boolean;
    errors: string[];
    warnings: string[];
    /** Anything worth saying about a value that passed. */
    notes: string[];
}
