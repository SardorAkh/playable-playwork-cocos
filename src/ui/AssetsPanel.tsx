import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import type { Translate } from '../i18n';
import { PROBE_BYTES, formatDuration, probeMedia } from '../core/media';
import type { MediaMeta } from '../core/media';
import { formatBytes } from '../core/networks';
import { isAssetParam, isFlat, isSwappable, sectionsOf } from '../core/schema';
import { entryByteLength, entryDataUrl, entryHead } from '../core/vfs';
import type { AssetFit, LoadedBuild, TuningParam, VfsEntry, VfsMap } from '../core/types';

export interface AssetSwap {
    fileName: string;
    bytes: number;
}

interface Props {
    build: LoadedBuild;
    overrides: VfsMap;
    swaps: Record<string, AssetSwap>;
    onSwap: (vfsPath: string, file: File) => void;
    onRevert: (vfsPath: string) => void;
    onDownload: (vfsPath: string, title: string) => void;
}

const VFS_LIST_LIMIT = 120;

function extension(path: string): string {
    const dot = path.lastIndexOf('.');
    return dot === -1 ? '' : path.slice(dot).toLowerCase();
}

/** Only the first bytes are decoded — headers carry everything the panel shows. */
function probeEntry(entry: VfsEntry | null): MediaMeta | null {
    if (!entry) return null;
    try {
        return probeMedia(entryHead(entry, PROBE_BYTES), entryByteLength(entry), entry.t);
    } catch {
        return null;
    }
}

/** Fills in what no header probe here covers (AVIF dimensions, m4a duration, …). */
function useMediaMeta(entry: VfsEntry | null): MediaMeta | null {
    const probed = useMemo(() => probeEntry(entry), [entry]);
    const [extra, setExtra] = useState<MediaMeta | null>(null);

    useEffect(() => {
        setExtra(null);
        if (!entry || !probed) return;
        const source = entryDataUrl(entry);

        if (entry.t.startsWith('image/') && !probed.width) {
            const image = new Image();
            image.onload = () => setExtra({ width: image.naturalWidth, height: image.naturalHeight });
            image.src = source;
            return () => {
                image.onload = null;
            };
        }
        if (entry.t.startsWith('video/')) {
            const video = document.createElement('video');
            const onMeta = () =>
                setExtra({
                    width: video.videoWidth,
                    height: video.videoHeight,
                    durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined,
                });
            video.addEventListener('loadedmetadata', onMeta);
            video.preload = 'metadata';
            video.src = source;
            return () => video.removeEventListener('loadedmetadata', onMeta);
        }
        if (entry.t.startsWith('audio/') && !probed.durationMs) {
            const audio = new Audio();
            const onMeta = () => {
                if (Number.isFinite(audio.duration)) setExtra({ durationMs: Math.round(audio.duration * 1000) });
            };
            audio.addEventListener('loadedmetadata', onMeta);
            audio.src = source;
            return () => audio.removeEventListener('loadedmetadata', onMeta);
        }
        return;
    }, [entry, probed]);

    if (!probed) return extra;
    return extra ? { ...probed, ...extra } : probed;
}

function describe(meta: MediaMeta | null, t: Translate): string[] {
    if (!meta) return [];
    const parts: string[] = [];
    if (meta.format) parts.push(meta.format);
    if (meta.width && meta.height) parts.push(`${meta.width} × ${meta.height}`);
    if (meta.durationMs) parts.push(formatDuration(meta.durationMs));
    if (meta.sampleRate) parts.push(`${(meta.sampleRate / 1000).toFixed(meta.sampleRate % 1000 ? 1 : 0)} kHz`);
    if (meta.channels) {
        parts.push(
            meta.channels === 1
                ? t('assets.mono')
                : meta.channels === 2
                  ? t('assets.stereo')
                  : t('assets.channels', { count: meta.channels }),
        );
    }
    if (meta.bitrateKbps) parts.push(`${meta.bitrateKbps} kbps`);
    return parts;
}

function ratio(width: number, height: number): string {
    return (width / height).toFixed(2);
}

function AssetRow({
    title,
    vfsPath,
    entry,
    original,
    fit,
    swap,
    onSwap,
    onRevert,
    onDownload,
    t,
}: {
    title: string;
    vfsPath: string;
    entry: VfsEntry;
    original?: VfsEntry;
    fit?: AssetFit;
    swap?: AssetSwap;
    onSwap: (vfsPath: string, file: File) => void;
    onRevert: (vfsPath: string) => void;
    onDownload: (vfsPath: string, title: string) => void;
    t: Translate;
}) {
    const isImage = entry.t.startsWith('image/');
    const isAudio = entry.t.startsWith('audio/');
    const isVideo = entry.t.startsWith('video/');
    const source = entryDataUrl(entry);
    const meta = useMediaMeta(entry);
    const before = useMediaMeta(swap && original ? original : null);

    /**
     * With `fit` the runtime redraws the replacement into the slot, so any size is fine and only
     * the aspect ratio is worth a word. Without it the bytes reach the engine as they are, and a
     * different size is what produces "Rect width exceeds maximum margin" (contract §4).
     */
    const offRatio =
        isImage && fit && meta?.width && meta.height
            ? ratio(meta.width, meta.height) !== ratio(fit.width, fit.height)
            : false;
    // Audio gets sniffed by signature at runtime (contract §4); video has no such promise, so a
    // different container is worth flagging even though the swap itself is allowed.
    const containerChanged = isVideo && before?.format && meta?.format && before.format !== meta.format
        ? before.format
        : null;

    const sizeMismatch =
        isImage && !fit && before?.width && meta?.width && (before.width !== meta.width || before.height !== meta.height)
            ? `${before.width} × ${before.height}`
            : null;

    return (
        <div className="asset">
            <div className="asset__preview">
                {isImage && <img src={source} alt={title} />}
                {isVideo && <video src={source} muted playsInline preload="metadata" />}
                {!isImage && !isVideo && <span className="asset__mime">{entry.t || '?'}</span>}
            </div>
            <div className="asset__meta">
                <div className="asset__title">{title}</div>
                <code className="asset__path" title={vfsPath}>
                    {vfsPath}
                </code>
                <div className="asset__size">
                    {[formatBytes(entryByteLength(entry)), extension(vfsPath) || entry.t, ...describe(meta, t)].join(
                        ' · ',
                    )}
                    {swap && <span className="pill pill--ok">{t('assets.swapped', { name: swap.fileName })}</span>}
                </div>
                {fit && (
                    <div className="asset__slot">
                        {t('assets.slot', {
                            raw: `${fit.rawWidth} × ${fit.rawHeight}`,
                            area: `${fit.width} × ${fit.height}`,
                            ratio: ratio(fit.width, fit.height),
                        })}
                    </div>
                )}
                {offRatio && <div className="asset__warn">{t('assets.offRatio')}</div>}
                {sizeMismatch && <div className="asset__warn">{t('assets.sizeMatters', { value: sizeMismatch })}</div>}
                {containerChanged && (
                    <div className="asset__warn">{t('assets.videoContainer', { from: containerChanged })}</div>
                )}
                {isAudio && <audio controls src={source} />}
                {isVideo && <video className="asset__video" controls muted playsInline preload="metadata" src={source} />}
                <div className="asset__actions">
                    <label className="control control--file">
                        {t('assets.replace')}
                        <input
                            type="file"
                            accept={isImage ? 'image/*' : isAudio ? 'audio/*' : isVideo ? 'video/*' : undefined}
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) onSwap(vfsPath, file);
                                event.target.value = '';
                            }}
                        />
                    </label>
                    <button className="control" onClick={() => onDownload(vfsPath, title)} title={t('assets.downloadHint')}>
                        {t('assets.download')}
                    </button>
                    {swap && (
                        <button className="control" onClick={() => onRevert(vfsPath)}>
                            {t('assets.revert')}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

/** Declared in the schema but absent from __TUNING_ASSETS__: shown, but not swappable. */
function LockedAssetRow({ param, t }: { param: TuningParam; t: Translate }) {
    return (
        <div className="asset asset--locked">
            <div className="asset__preview">
                <span className="asset__mime">{param.type}</span>
            </div>
            <div className="asset__meta">
                <div className="asset__title">{param.label ?? param.key}</div>
                {param.asset && (
                    <code className="asset__path" title={param.asset}>
                        {param.asset}
                    </code>
                )}
                <div className="asset__warn">{t('assets.locked')}</div>
            </div>
        </div>
    );
}

export function AssetsPanel({ build, overrides, swaps, onSwap, onRevert, onDownload }: Props) {
    const { t } = useI18n();
    const [filter, setFilter] = useState('');
    const [showAll, setShowAll] = useState(false);
    const vfs = build.vfs;

    const sections = useMemo(
        () =>
            sectionsOf(build.schema).map((section) => ({
                ...section,
                params: section.params.filter(isAssetParam),
            })),
        [build.schema],
    );
    const flat = isFlat(sections);
    const declaredCount = sections.reduce((total, section) => total + section.params.length, 0);

    const media = useMemo(() => {
        if (!vfs) return [];
        const declaredPaths = new Set(
            sections.flatMap((section) => section.params.map((param) => build.assets[param.key]?.file).filter(Boolean)),
        );
        const needle = filter.trim().toLowerCase();
        return Object.keys(vfs)
            .filter((path) => !declaredPaths.has(path))
            .filter((path) => /^(image|audio|video)\//.test(vfs[path].t))
            .filter((path) => (needle ? path.toLowerCase().includes(needle) : true));
    }, [vfs, sections, build.assets, filter]);

    if (!vfs) return <div className="panel__empty">{t('assets.noVfs')}</div>;

    const current = (path: string) => overrides[path] ?? vfs[path];

    const rowsFor = (params: TuningParam[]) =>
        params.map((param) => {
            if (!isSwappable(param, build.assets)) return <LockedAssetRow key={param.key} param={param} t={t} />;
            const ref = build.assets[param.key];
            if (!vfs[ref.file]) {
                return (
                    <div className="panel__empty" key={param.key}>
                        {t('assets.missing', { title: param.label ?? param.key, path: ref.file })}
                    </div>
                );
            }
            return (
                <AssetRow
                    key={param.key}
                    title={param.label ?? param.key}
                    vfsPath={ref.file}
                    entry={current(ref.file)}
                    original={vfs[ref.file]}
                    fit={ref.fit}
                    swap={swaps[ref.file]}
                    onSwap={onSwap}
                    onRevert={onRevert}
                    onDownload={onDownload}
                    t={t}
                />
            );
        });

    return (
        <div className="panel__body">
            {declaredCount === 0 ? (
                <div className="panel__note">{t('assets.noDeclared')}</div>
            ) : flat ? (
                rowsFor(sections.flatMap((section) => section.params))
            ) : (
                sections
                    .filter((section) => section.params.length > 0)
                    .map((section) => (
                        <section className="section" key={section.id}>
                            <div className="section__head section__head--static">
                                <span className="section__title">{section.title}</span>
                                <span className="section__count">{section.params.length}</span>
                            </div>
                            <div className="section__body">
                                {section.description && <div className="section__note">{section.description}</div>}
                                {rowsFor(section.params)}
                            </div>
                        </section>
                    ))
            )}

            <div className="panel__tools">
                <input
                    className="control control--wide"
                    placeholder={t('assets.filter')}
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                />
                <button className="control" onClick={() => setShowAll((value) => !value)}>
                    {showAll ? t('assets.collapse') : t('assets.showAll', { count: media.length })}
                </button>
            </div>

            {showAll &&
                media.slice(0, VFS_LIST_LIMIT).map((path) => (
                    <AssetRow
                        key={path}
                        title={path.split('/').pop() ?? path}
                        vfsPath={path}
                        entry={current(path)}
                        original={vfs[path]}
                        swap={swaps[path]}
                        onSwap={onSwap}
                        onRevert={onRevert}
                        onDownload={onDownload}
                        t={t}
                    />
                ))}
            {showAll && media.length > VFS_LIST_LIMIT && (
                <div className="panel__note">{t('assets.limit', { count: VFS_LIST_LIMIT })}</div>
            )}
        </div>
    );
}
