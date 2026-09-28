import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { composeHtml, loadBuild } from './core/bundle';
import { entryBytes, withBytes } from './core/vfs';
import {
    DEFAULT_ORIENTATION_SUFFIX,
    ORIENTATIONS,
    buildArtifact,
    packExport,
    planExport,
    suggestBaseName,
    targetFormat,
} from './core/export';
import type { ExportSettings } from './core/export';
import { NETWORKS, formatBytes, guessNetwork } from './core/networks';
import { PREVIEW_CHANNEL, TUNING_CHANNEL, withPreviewShim } from './core/previewShim';
import type { LoadedBuild, TuningValues, ValidationIssue, VfsMap } from './core/types';
import { validate } from './core/validate';
import { useI18n } from './i18n';
import type { Lang } from './i18n';
import { applyTheme, readTheme } from './theme';
import type { Theme } from './theme';
import { AssetsPanel } from './ui/AssetsPanel';
import type { AssetSwap } from './ui/AssetsPanel';
import { DEFAULT_PREVIEW, DevicePreview } from './ui/DevicePreview';
import type { PreviewSettings } from './ui/DevicePreview';
import { EventLog } from './ui/EventLog';
import type { EventKind, PreviewEvent } from './ui/EventLog';
import { ExportPanel } from './ui/ExportPanel';
import type { NetworkCheck, SourceInfo } from './ui/ExportPanel';
import { IssuesPanel } from './ui/IssuesPanel';
import { ParamsPanel } from './ui/ParamsPanel';

const SETTINGS_KEY = 'playable-tuner:preview';
const RELOAD_GRACE_MS = 2000;
type Tab = 'params' | 'assets' | 'export' | 'issues' | 'log';

interface Source {
    id: string;
    build: LoadedBuild;
    /** Empty for a tuner bundle: it is not tied to any single network. */
    networkId: string;
}

function readSettings(): PreviewSettings {
    try {
        return { ...DEFAULT_PREVIEW, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as PreviewSettings) };
    } catch {
        return DEFAULT_PREVIEW;
    }
}

function emptyExportSettings(): ExportSettings {
    return {
        baseName: 'playable',
        networks: NETWORKS.map((network) => ({
            networkId: network.id,
            enabled: false,
            suffix: network.suffix,
            folder: network.folder,
            sourceId: null,
        })),
        orientations: ORIENTATIONS.map((orientation) => ({
            orientation,
            enabled: false,
            suffix: DEFAULT_ORIENTATION_SUFFIX[orientation],
        })),
    };
}

function defaultsFrom(build: LoadedBuild, current: TuningValues): TuningValues {
    const values: TuningValues = { ...build.values, ...current };
    for (const param of build.schema?.params ?? []) {
        if (param.default !== undefined && values[param.key] === undefined) values[param.key] = param.default;
    }
    return values;
}

/** image / audio / null — what kind of file a mime or extension stands for. */
function mediaKind(hint: string): 'image' | 'audio' | 'video' | null {
    if (/^image\/|\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(hint)) return 'image';
    if (/^audio\/|\.(mp3|ogg|wav|m4a|aac|opus)$/i.test(hint)) return 'audio';
    if (/^video\/|\.(mp4|webm|mov|m4v|mkv)$/i.test(hint)) return 'video';
    return null;
}

function extensionOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

function download(blob: Blob, name: string): void {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

export default function App() {
    const { t, lang, setLang } = useI18n();
    const [theme, setTheme] = useState<Theme>(readTheme);
    const [sources, setSources] = useState<Source[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [values, setValuesState] = useState<TuningValues>({});
    const [overrides, setOverridesState] = useState<VfsMap>({});
    const [swaps, setSwaps] = useState<Record<string, AssetSwap>>({});
    const [exportSettings, setExportSettings] = useState<ExportSettings>(emptyExportSettings);
    const [settings, setSettings] = useState<PreviewSettings>(readSettings);
    const [previewHtml, setPreviewHtml] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const [stale, setStale] = useState(false);
    const [busy, setBusy] = useState(false);
    const [events, setEvents] = useState<PreviewEvent[]>([]);
    const [checks, setChecks] = useState<NetworkCheck[]>([]);
    const [checkedAt, setCheckedAt] = useState<number | null>(null);
    const [tab, setTab] = useState<Tab>('params');
    const [loadError, setLoadError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);

    // Loading several builds in a row composes previews between renders, so the edits live in
    // refs and the state follows — reading them from a stale closure would lose values.
    const valuesRef = useRef<TuningValues>({});
    const overridesRef = useRef<VfsMap>({});

    const setValues = useCallback((update: (prev: TuningValues) => TuningValues) => {
        valuesRef.current = update(valuesRef.current);
        setValuesState(valuesRef.current);
        return valuesRef.current;
    }, []);

    const setOverrides = useCallback((update: (prev: VfsMap) => VfsMap) => {
        overridesRef.current = update(overridesRef.current);
        setOverridesState(overridesRef.current);
        return overridesRef.current;
    }, []);

    const iframeRef = useRef<HTMLIFrameElement>(null);
    const eventId = useRef(0);
    const sourceId = useRef(0);
    const deepLinkLoaded = useRef(false);
    /** Our own restart unloads the frame too — don't report that as a redirect attempt. */
    const reloadingUntil = useRef(0);
    const runtimeRedirects = useRef<string[]>([]);
    const runtimeRequests = useRef<string[]>([]);

    const active = sources.find((source) => source.id === activeId) ?? null;
    const build = active?.build ?? null;

    useEffect(() => applyTheme(theme), [theme]);
    useEffect(() => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)), [settings]);

    const pushEvent = useCallback((kind: EventKind, code: string, params?: PreviewEvent['params'], truncated?: number) => {
        eventId.current += 1;
        const entry: PreviewEvent = { id: eventId.current, at: Date.now(), kind, code, params, truncated };
        setEvents((prev) => [entry, ...prev].slice(0, 300));
    }, []);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.source !== iframeRef.current?.contentWindow) return;
            const data = event.data as { channel?: string; type?: string; payload?: Record<string, unknown> };
            if (!data || data.channel !== PREVIEW_CHANNEL) return;
            const payload = (data.payload ?? {}) as Record<string, string | number | undefined>;
            const cut = typeof payload.full === 'number' ? payload.full : undefined;
            switch (data.type) {
                case 'ready':
                    pushEvent('ready', 'shim-ready');
                    break;
                case 'loaded':
                    pushEvent('loaded', 'window-load');
                    break;
                case 'lifecycle':
                    pushEvent('lifecycle', 'lifecycle', { name: String(payload.name), args: String(payload.args ?? '') }, cut);
                    break;
                case 'cta':
                    pushEvent('cta', payload.url ? 'cta-url' : 'cta', {
                        via: String(payload.via),
                        url: String(payload.url ?? ''),
                    });
                    break;
                case 'redirect':
                    if (Date.now() < reloadingUntil.current) break;
                    runtimeRedirects.current = [...runtimeRedirects.current, String(payload.via)];
                    pushEvent('redirect', 'redirect', { via: String(payload.via), url: String(payload.url ?? '') });
                    break;
                case 'request':
                    runtimeRequests.current = [...runtimeRequests.current, String(payload.url)];
                    pushEvent('request', 'request', { method: String(payload.method), url: String(payload.url) });
                    break;
                case 'error':
                    pushEvent('error', 'raw', { text: String(payload.text) }, cut);
                    break;
                case 'console':
                    pushEvent('console', 'console', { level: String(payload.level), text: String(payload.text) }, cut);
                    break;
                case 'patched':
                    pushEvent('patched', 'patched', { keys: String(payload.keys ?? '') });
                    break;
                default:
                    break;
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [pushEvent]);

    const rebuildPreview = useCallback(
        async (source?: LoadedBuild, nextValues?: TuningValues, nextOverrides?: VfsMap) => {
            const target = source ?? build;
            if (!target) return;
            setBusy(true);
            reloadingUntil.current = Date.now() + RELOAD_GRACE_MS;
            runtimeRedirects.current = [];
            runtimeRequests.current = [];
            await new Promise((resolve) => setTimeout(resolve, 0));
            try {
                const html = composeHtml(target, nextValues ?? valuesRef.current, nextOverrides ?? overridesRef.current);
                setPreviewHtml(withPreviewShim(html));
                setReloadToken((token) => token + 1);
                setStale(false);
                pushEvent('tuner', 'preview-reloaded');
            } finally {
                setBusy(false);
            }
        },
        [build, pushEvent],
    );

    const sourceInfos: SourceInfo[] = useMemo(
        () =>
            sources.map((source) => ({
                id: source.id,
                fileName: source.build.fileName,
                networkId: source.networkId,
                format: source.build.kind,
                bundle: source.build.manifest !== null,
                recipeFormats: Object.fromEntries(
                    (source.build.manifest?.networks ?? []).map((recipe) => [recipe.id, recipe.format]),
                ),
            })),
        [sources],
    );

    const exportItems = useMemo(
        () => planExport(exportSettings, NETWORKS, sourceInfos),
        [exportSettings, sourceInfos],
    );

    /** Validates every network that is actually going to be exported, not just the visible one. */
    const runValidation = useCallback(async (): Promise<NetworkCheck[]> => {
        if (sources.length === 0) return [];
        setBusy(true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        try {
            // Swaps raise nothing on their own any more: the runtime fits images into their slot
            // and detects audio by signature, so only size against the network limit still matters.
            const assetIssues: ValidationIssue[] = [];
            const targets = exportSettings.networks.filter((target) => target.enabled && target.sourceId);
            const pending = targets.length > 0 ? targets : [];
            const results: NetworkCheck[] = [];

            for (const target of pending) {
                const source = sources.find((item) => item.id === target.sourceId);
                const network = NETWORKS.find((item) => item.id === target.networkId);
                if (!source || !network) continue;
                // A bundle only grows its network SDK during re-wrap, so validate what is shipped.
                const artifact = await buildArtifact(source.build, network.id, null, values, overrides);
                const info = sourceInfos.find((item) => item.id === source.id);
                results.push({
                    networkId: network.id,
                    sizeBytes: artifact.blob.size,
                    issues: validate({
                        build: source.build,
                        html: artifact.html,
                        values,
                        sizeBytes: artifact.blob.size,
                        network: artifact.maxBytes ? { ...network, maxBytes: artifact.maxBytes } : network,
                        artifactFormat: info ? targetFormat(info, network) : undefined,
                        assetIssues,
                        runtimeRedirects: runtimeRedirects.current,
                        runtimeRequests: runtimeRequests.current,
                    }),
                });
            }
            setChecks(results);
            setCheckedAt(Date.now());
            return results;
        } finally {
            setBusy(false);
        }
    }, [exportSettings.networks, overrides, sourceInfos, sources, swaps, values]);

    const openBuild = useCallback(
        async (file: File) => {
            setLoadError(null);
            setBusy(true);
            try {
                const loaded = await loadBuild(file);
                const isBundle = loaded.manifest !== null;
                const network = guessNetwork(loaded.fileName, loaded.kind);
                sourceId.current += 1;
                const id = `source-${sourceId.current}`;
                const source: Source = { id, build: loaded, networkId: isBundle ? '' : network.id };

                setSources((prev) => [...prev.filter((item) => item.build.fileName !== loaded.fileName), source]);
                setActiveId(id);
                setChecks([]);
                setCheckedAt(null);
                setTab(loaded.schema ? 'params' : 'export');

                const nextValues = setValues((prev) => defaultsFrom(loaded, prev));
                setExportSettings((prev) => ({
                    ...prev,
                    baseName: prev.baseName === 'playable' ? suggestBaseName(loaded.fileName) : prev.baseName,
                    networks: prev.networks.map((target) => {
                        // A bundle can produce every network, so it claims the ones still unassigned.
                        if (isBundle) return target.sourceId ? target : { ...target, enabled: true, sourceId: id };
                        return target.networkId === network.id ? { ...target, enabled: true, sourceId: id } : target;
                    }),
                }));

                pushEvent('tuner', 'build-loaded', {
                    name: loaded.fileName,
                    size: formatBytes(loaded.sourceBytes),
                });
                await rebuildPreview(loaded, nextValues, overridesRef.current);
            } catch (error) {
                setLoadError(error instanceof Error ? error.message : String(error));
            } finally {
                setBusy(false);
            }
        },
        [pushEvent, rebuildPreview, setValues],
    );

    const openFiles = useCallback(
        async (files: FileList | File[]) => {
            for (const file of Array.from(files)) await openBuild(file);
        },
        [openBuild],
    );

    const removeSource = useCallback(
        (id: string) => {
            setSources((prev) => prev.filter((source) => source.id !== id));
            setExportSettings((prev) => ({
                ...prev,
                networks: prev.networks.map((target) =>
                    target.sourceId === id ? { ...target, enabled: false, sourceId: null } : target,
                ),
            }));
            setActiveId((prev) => (prev === id ? (sources.find((source) => source.id !== id)?.id ?? null) : prev));
            setChecks([]);
            setCheckedAt(null);
        },
        [sources],
    );

    useEffect(() => {
        const source = new URLSearchParams(window.location.search).get('src');
        if (!source || deepLinkLoaded.current) return;
        deepLinkLoaded.current = true;
        fetch(source)
            .then((response) => response.blob())
            .then((blob) => openBuild(new File([blob], source.split('/').pop() ?? 'build.html')))
            .catch((error: unknown) => setLoadError(t('top.loadFailed', { src: source, message: String(error) })));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const changeValue = useCallback(
        (key: string, value: unknown) => {
            setValues((prev) => ({ ...prev, [key]: value }));
            setCheckedAt(null);
            const param = build?.schema?.params.find((item) => item.key === key);
            const frame = iframeRef.current?.contentWindow;
            if (param?.live && frame) {
                frame.postMessage({ channel: TUNING_CHANNEL, type: 'patch', values: { [key]: value } }, '*');
                pushEvent('tuner', 'live-patch', { key });
            } else {
                setStale(true);
            }
        },
        [build, pushEvent],
    );

    const swapAsset = useCallback(
        async (vfsPath: string, file: File) => {
            if (!build?.vfs) return;
            const entry = build.vfs[vfsPath];

            // Any image may replace an image and any sound a sound — the runtime sorts out format
            // and size. Crossing the two is the one thing it cannot rescue (contract §4).
            const slot = mediaKind(entry.t);
            const incoming = mediaKind(file.type) ?? mediaKind(extensionOf(file.name));
            if (slot && incoming !== slot) {
                setNotice(t('assets.wrongKind', { name: file.name, kind: t(`assets.kind-${slot}`) }));
                return;
            }

            setNotice(null);
            const bytes = new Uint8Array(await file.arrayBuffer());
            setOverrides((prev) => ({ ...prev, [vfsPath]: withBytes(entry, bytes) }));
            setSwaps((prev) => ({ ...prev, [vfsPath]: { fileName: file.name, bytes: bytes.length } }));
            setStale(true);
            setCheckedAt(null);
            pushEvent('tuner', 'asset-swapped', {
                path: vfsPath,
                name: file.name,
                size: formatBytes(bytes.length),
            });
        },
        [build, pushEvent, setNotice, setOverrides, setSwaps, t],
    );

    const downloadAsset = useCallback(
        (vfsPath: string, title: string) => {
            const entry = overridesRef.current[vfsPath] ?? build?.vfs?.[vfsPath];
            if (!entry) return;
            const dot = vfsPath.lastIndexOf('.');
            const suffix = dot === -1 ? '' : vfsPath.slice(dot);
            const stem = title.replace(/[\/:*?"<>|]+/g, '').trim() || 'asset';
            const bytes = entryBytes(entry);
            download(new Blob([bytes.slice()], { type: entry.t }), stem + suffix);
            pushEvent('tuner', 'asset-downloaded', { path: vfsPath, size: formatBytes(bytes.length) });
        },
        [build, pushEvent],
    );

    const revertAsset = useCallback(
        (vfsPath: string) => {
            setOverrides((prev) => {
                const next = { ...prev };
                delete next[vfsPath];
                return next;
            });
            setSwaps((prev) => {
                const next = { ...prev };
                delete next[vfsPath];
                return next;
            });
            setStale(true);
            setCheckedAt(null);
            pushEvent('tuner', 'asset-reverted', { path: vfsPath });
        },
        [pushEvent],
    );

    const runExport = useCallback(async () => {
        if (exportItems.length === 0) return;

        // The file is always produced; a known problem is reported, never a reason to refuse.
        const known = checks.reduce(
            (total, check) => total + check.issues.filter((issue) => issue.severity === 'error').length,
            0,
        );
        setNotice(known > 0 ? t('top.exportedWithErrors', { count: known }) : null);
        setBusy(true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        try {
            const { blob, sizes } = await packExport(
                exportItems,
                sources.map((source) => ({ id: source.id, build: source.build })),
                values,
                overrides,
            );
            if (exportItems.length === 1) {
                // A single target does not need a folder around it.
                const only = exportItems[0];
                const source = sources.find((item) => item.id === only.sourceId)!;
                const artifact = await buildArtifact(source.build, only.networkId, only.orientation, values, overrides);
                download(artifact.blob, only.path.split('/').pop()!);
                pushEvent('tuner', 'exported', {
                    name: only.path,
                    size: formatBytes(sizes.get(only.path) ?? 0),
                });
                return;
            }
            const name = `${exportSettings.baseName || 'playable'}_playables.zip`;
            download(blob, name);
            pushEvent('tuner', 'exported', { name: `${name} · ${exportItems.length}`, size: formatBytes(blob.size) });
        } finally {
            setBusy(false);
        }
    }, [checks, exportItems, exportSettings.baseName, overrides, pushEvent, sources, t, values]);

    useEffect(() => {
        if (!settings.autoReload || !stale || busy) return;
        const timer = setTimeout(() => void rebuildPreview(), 600);
        return () => clearTimeout(timer);
    }, [busy, rebuildPreview, settings.autoReload, stale]);

    const errorCount = checks.reduce(
        (total, check) => total + check.issues.filter((issue) => issue.severity === 'error').length,
        0,
    );
    const hasBlocking = errorCount > 0;
    const logErrors = events.filter((event) => event.kind === 'error' || event.kind === 'request').length;
    const activeSize = build ? build.sourceBytes : 0;

    const onDrop = (event: React.DragEvent) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files?.length) void openFiles(event.dataTransfer.files);
    };

    return (
        <div
            className={dragging ? 'app app--dragging' : 'app'}
            onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
        >
            <header className="top">
                <div className="top__brand">
                    Playable <span>Tuner</span>
                </div>
                {build ? (
                    <div className="top__file">
                        <strong>{build.fileName}</strong>
                        <span>
                            {formatBytes(activeSize)} · .{build.kind} ·{' '}
                            {build.hasTuningBlock ? t('top.withTuning') : t('top.withoutTuning')}
                        </span>
                    </div>
                ) : (
                    <div className="top__file top__file--muted">{t('top.noFile')}</div>
                )}
                <div className="top__actions">
                    <select
                        className="control control--mini"
                        value={theme}
                        onChange={(event) => setTheme(event.target.value as Theme)}
                        title={t('theme.label')}
                    >
                        <option value="auto">◐ {t('theme.auto')}</option>
                        <option value="light">☀ {t('theme.light')}</option>
                        <option value="dark">☾ {t('theme.dark')}</option>
                    </select>
                    <div className="seg seg--mini">
                        {(['en', 'ru'] as Lang[]).map((code) => (
                            <button
                                key={code}
                                className={lang === code ? 'seg__btn is-on' : 'seg__btn'}
                                onClick={() => setLang(code)}
                            >
                                {t(`lang.${code}`)}
                            </button>
                        ))}
                    </div>
                    <label className="control control--file">
                        {sources.length === 0 ? t('top.upload') : t('sources.add')}
                        <input
                            type="file"
                            multiple
                            accept=".html,.zip,text/html,application/zip"
                            onChange={(event) => {
                                if (event.target.files?.length) void openFiles(event.target.files);
                                event.target.value = '';
                            }}
                        />
                    </label>
                    <button
                        className={hasBlocking ? 'control control--primary is-stale' : 'control control--primary'}
                        disabled={exportItems.length === 0 || busy}
                        title={hasBlocking ? t('top.exportWarnHint', { count: errorCount }) : undefined}
                        onClick={() => void runExport()}
                    >
                        {t('top.exportCount', { count: exportItems.length })}
                    </button>
                </div>
            </header>

            {sources.length > 0 && (
                <div className="sources">
                    <span className="sources__label">{t('sources.title')}</span>
                    {sources.map((source) => (
                        <span
                            className={source.id === activeId ? 'chip chip--on' : 'chip'}
                            key={source.id}
                            onClick={() => {
                                setActiveId(source.id);
                                void rebuildPreview(source.build);
                            }}
                        >
                            {source.build.fileName}
                            <em>
                                {source.build.manifest
                                    ? t('sources.bundle')
                                    : NETWORKS.find((network) => network.id === source.networkId)?.label}
                            </em>
                            <button
                                title={t('sources.remove')}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    removeSource(source.id);
                                }}
                            >
                                ×
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {loadError && <div className="banner banner--error">{loadError}</div>}
            {notice && <div className="banner banner--error">{notice}</div>}

            <main className="layout">
                <DevicePreview
                    html={previewHtml}
                    reloadToken={reloadToken}
                    settings={settings}
                    stale={stale}
                    busy={busy}
                    onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
                    onReload={() => void rebuildPreview()}
                    iframeRef={iframeRef}
                />

                <aside className="side">
                    <nav className="tabs">
                        {(
                            [
                                ['params', t('tabs.params')],
                                ['assets', t('tabs.assets')],
                                ['export', t('tabs.export')],
                                ['issues', errorCount > 0 ? `${t('tabs.issues')} (${errorCount})` : t('tabs.issues')],
                                ['log', logErrors > 0 ? `${t('tabs.log')} (${logErrors})` : t('tabs.log')],
                            ] as [Tab, string][]
                        ).map(([id, label]) => (
                            <button key={id} className={tab === id ? 'tabs__btn is-on' : 'tabs__btn'} onClick={() => setTab(id)}>
                                {label}
                            </button>
                        ))}
                    </nav>

                    <div className="panel">
                        {!build && <div className="panel__empty">{t('top.dropHint')}</div>}
                        {build && tab === 'params' && (
                            <ParamsPanel
                                schema={build.schema}
                                values={values}
                                onChange={changeValue}
                                onReset={() => {
                                    setValues(() => defaultsFrom(build, {}));
                                    setStale(true);
                                    setCheckedAt(null);
                                }}
                                onApplyPreset={(preset) => {
                                    setValues((prev) => ({ ...prev, ...preset }));
                                    setStale(true);
                                    setCheckedAt(null);
                                }}
                            />
                        )}
                        {build && tab === 'assets' && (
                            <AssetsPanel
                                build={build}
                                overrides={overrides}
                                swaps={swaps}
                                onSwap={(path, file) => void swapAsset(path, file)}
                                onRevert={revertAsset}
                                onDownload={downloadAsset}
                            />
                        )}
                        {build && tab === 'export' && (
                            <ExportPanel
                                sources={sourceInfos}
                                settings={exportSettings}
                                checks={checks}
                                busy={busy}
                                onChange={(next) => {
                                    setExportSettings(next);
                                    setCheckedAt(null);
                                }}
                                onValidateAll={() => void runValidation()}
                            />
                        )}
                        {build && tab === 'issues' && (
                            <IssuesPanel
                                build={build}
                                checks={checks}
                                checkedAt={checkedAt}
                                busy={busy}
                                onRecheck={() => void runValidation()}
                            />
                        )}
                        {build && tab === 'log' && <EventLog events={events} onClear={() => setEvents([])} />}
                    </div>
                </aside>
            </main>

            {dragging && <div className="dropveil">{t('top.dropVeil')}</div>}
        </div>
    );
}
