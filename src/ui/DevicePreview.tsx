import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { PREVIEW_HOST_CHANNEL, PREVIEW_HOST_URL } from '../core/previewShim';
import { DEVICES, RESPONSIVE_PRESETS, deviceSize } from './devices';
import type { DevicePreset, Orientation } from './devices';

export interface PreviewSettings {
    mode: 'device' | 'responsive';
    deviceId: string;
    orientation: Orientation;
    responsive: { width: number; height: number };
    zoom: 'fit' | number;
    strictSandbox: boolean;
    autoReload: boolean;
}

export const DEFAULT_PREVIEW: PreviewSettings = {
    mode: 'device',
    deviceId: 'iphone-15-pro',
    orientation: 'portrait',
    responsive: { width: 414, height: 896 },
    zoom: 'fit',
    strictSandbox: false,
    autoReload: false,
};

interface Props {
    /** Composed preview document, posted into the preview host page once it reports ready. */
    html: string | null;
    reloadToken: number;
    settings: PreviewSettings;
    stale: boolean;
    busy: boolean;
    onChange: (patch: Partial<PreviewSettings>) => void;
    onReload: () => void;
    iframeRef: React.RefObject<HTMLIFrameElement>;
}

const MIN_SIDE = 200;
const MAX_SIDE = 4000;
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2];

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function useElementSize<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    useLayoutEffect(() => {
        const node = ref.current;
        if (!node) return;
        const observer = new ResizeObserver(([entry]) => {
            setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, []);
    return [ref, size] as const;
}

export function DevicePreview(props: Props) {
    const { t } = useI18n();
    const { html, reloadToken, settings, stale, busy, onChange, onReload, iframeRef } = props;
    const device: DevicePreset = DEVICES.find((item) => item.id === settings.deviceId) ?? DEVICES[0];
    const isDevice = settings.mode === 'device';
    const size = isDevice ? deviceSize(device, settings.orientation) : settings.responsive;
    const bezel = isDevice ? device.bezel : 0;

    const [viewportRef, viewport] = useElementSize<HTMLDivElement>();
    const outerWidth = size.width + bezel * 2;
    const outerHeight = size.height + bezel * 2;

    const fitScale =
        viewport.width > 0 && viewport.height > 0
            ? Math.min(1, viewport.width / outerWidth, viewport.height / outerHeight)
            : 1;
    const scale = settings.zoom === 'fit' ? Math.max(0.1, fitScale) : settings.zoom;
    const scaleRef = useRef(scale);
    scaleRef.current = scale;

    const rotate = useCallback(() => {
        onChange(
            isDevice
                ? { orientation: settings.orientation === 'portrait' ? 'landscape' : 'portrait' }
                : { responsive: { width: settings.responsive.height, height: settings.responsive.width } },
        );
    }, [isDevice, onChange, settings.orientation, settings.responsive]);

    const startResize = useCallback(
        (event: React.PointerEvent<HTMLDivElement>, axis: 'x' | 'y' | 'both') => {
            event.preventDefault();
            const startX = event.clientX;
            const startY = event.clientY;
            const startWidth = settings.responsive.width;
            const startHeight = settings.responsive.height;
            const dragScale = scaleRef.current;

            const move = (moveEvent: PointerEvent) => {
                const dx = (moveEvent.clientX - startX) / dragScale;
                const dy = (moveEvent.clientY - startY) / dragScale;
                onChange({
                    responsive: {
                        width: axis === 'y' ? startWidth : clamp(Math.round(startWidth + dx), MIN_SIDE, MAX_SIDE),
                        height: axis === 'x' ? startHeight : clamp(Math.round(startHeight + dy), MIN_SIDE, MAX_SIDE),
                    },
                });
            };
            const stop = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', stop);
                document.body.classList.remove('resizing');
            };
            document.body.classList.add('resizing');
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', stop);
        },
        [onChange, settings.responsive],
    );

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (!html || event.source !== iframeRef.current?.contentWindow) return;
            const data = event.data as { channel?: string; type?: string };
            if (!data || data.channel !== PREVIEW_HOST_CHANNEL || data.type !== 'ready') return;
            (event.source as Window).postMessage({ channel: PREVIEW_HOST_CHANNEL, type: 'write', html }, '*');
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [html, iframeRef]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
            if (event.key === 'r' || event.key === 'к') onReload();
            if (event.key === 'o' || event.key === 'щ') rotate();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onReload, rotate]);

    const sandbox = settings.strictSandbox
        ? 'allow-scripts'
        : 'allow-scripts allow-same-origin allow-pointer-lock allow-popups-to-escape-sandbox';

    return (
        <section className="stage">
            <div className="stage__bar">
                <div className="seg">
                    <button className={isDevice ? 'seg__btn is-on' : 'seg__btn'} onClick={() => onChange({ mode: 'device' })}>
                        {t('stage.device')}
                    </button>
                    <button
                        className={!isDevice ? 'seg__btn is-on' : 'seg__btn'}
                        onClick={() => onChange({ mode: 'responsive' })}
                    >
                        {t('stage.responsive')}
                    </button>
                </div>

                {isDevice ? (
                    <select
                        className="control"
                        value={settings.deviceId}
                        onChange={(event) => onChange({ deviceId: event.target.value })}
                    >
                        {['iPhone', 'iPad', 'Android'].map((group) => (
                            <optgroup key={group} label={group}>
                                {DEVICES.filter((item) => item.group === group).map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.label} — {item.width}×{item.height}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                ) : (
                    <div className="sizebox">
                        <input
                            className="control control--num"
                            type="number"
                            value={settings.responsive.width}
                            min={MIN_SIDE}
                            max={MAX_SIDE}
                            onChange={(event) =>
                                onChange({
                                    responsive: {
                                        ...settings.responsive,
                                        width: clamp(Number(event.target.value) || MIN_SIDE, MIN_SIDE, MAX_SIDE),
                                    },
                                })
                            }
                        />
                        <span className="sizebox__x">×</span>
                        <input
                            className="control control--num"
                            type="number"
                            value={settings.responsive.height}
                            min={MIN_SIDE}
                            max={MAX_SIDE}
                            onChange={(event) =>
                                onChange({
                                    responsive: {
                                        ...settings.responsive,
                                        height: clamp(Number(event.target.value) || MIN_SIDE, MIN_SIDE, MAX_SIDE),
                                    },
                                })
                            }
                        />
                        <select
                            className="control"
                            value=""
                            onChange={(event) => {
                                const preset = RESPONSIVE_PRESETS.find((item) => item.label === event.target.value);
                                if (preset) onChange({ responsive: { width: preset.width, height: preset.height } });
                            }}
                        >
                            <option value="">{t('stage.presetPlaceholder')}</option>
                            {RESPONSIVE_PRESETS.map((preset) => (
                                <option key={preset.label} value={preset.label}>
                                    {preset.label}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                <button className="control" onClick={rotate} title={t('stage.rotateHint')}>
                    ⟳{' '}
                    {isDevice
                        ? settings.orientation === 'portrait'
                            ? t('stage.portrait')
                            : t('stage.landscape')
                        : t('stage.rotate')}
                </button>

                <select
                    className="control"
                    value={settings.zoom === 'fit' ? 'fit' : String(settings.zoom)}
                    onChange={(event) =>
                        onChange({ zoom: event.target.value === 'fit' ? 'fit' : Number(event.target.value) })
                    }
                >
                    <option value="fit">{t('stage.fit')}</option>
                    {ZOOM_STEPS.map((step) => (
                        <option key={step} value={step}>
                            {Math.round(step * 100)}%
                        </option>
                    ))}
                </select>

                <button
                    className={stale ? 'control control--primary is-stale' : 'control control--primary'}
                    onClick={onReload}
                    disabled={!html || busy}
                    title={t('stage.reloadHint')}
                >
                    {busy ? '…' : '↻'} {t('stage.reload')}
                </button>
            </div>

            <div className="stage__viewport" ref={viewportRef}>
                {html ? (
                    <div className="frame-slot" style={{ width: outerWidth * scale, height: outerHeight * scale }}>
                    <div
                        className={isDevice ? 'frame frame--device' : 'frame frame--plain'}
                        style={{
                            width: outerWidth,
                            height: outerHeight,
                            transform: `scale(${scale})`,
                            transformOrigin: 'top left',
                            borderWidth: bezel,
                            borderRadius: isDevice ? device.radius : 6,
                        }}
                    >
                        <div
                            className="frame__screen"
                            style={{
                                width: size.width,
                                height: size.height,
                                borderRadius: isDevice ? Math.max(0, device.radius - device.bezel) : 4,
                            }}
                        >
                            <iframe
                                key={reloadToken}
                                ref={iframeRef}
                                className="frame__iframe"
                                title="playable preview"
                                src={PREVIEW_HOST_URL}
                                sandbox={sandbox}
                                allow="autoplay; fullscreen"
                            />
                            {isDevice && device.notch !== 'none' && (
                                <div className={`notch notch--${device.notch} notch--${settings.orientation}`} />
                            )}
                            {isDevice && device.homeIndicator && (
                                <div className={`home-bar home-bar--${settings.orientation}`} />
                            )}
                        </div>
                    </div>
                        {!isDevice && (
                            <>
                                <div className="grip grip--x" onPointerDown={(event) => startResize(event, 'x')} />
                                <div className="grip grip--y" onPointerDown={(event) => startResize(event, 'y')} />
                                <div className="grip grip--both" onPointerDown={(event) => startResize(event, 'both')} />
                            </>
                        )}
                    </div>
                ) : (
                    <div className="stage__empty">{t('stage.empty')}</div>
                )}
            </div>

            <div className="stage__status">
                <span>
                    {size.width} × {size.height} · {Math.round(scale * 100)}%
                </span>
                {stale && <span className="pill pill--warn">{t('stage.stale')}</span>}
                <label className="check check--tiny">
                    <input
                        type="checkbox"
                        checked={settings.autoReload}
                        onChange={(event) => onChange({ autoReload: event.target.checked })}
                    />
                    {t('stage.autoReload')}
                </label>
                <label className="check check--tiny" title={t('stage.strictSandboxHint')}>
                    <input
                        type="checkbox"
                        checked={settings.strictSandbox}
                        onChange={(event) => onChange({ strictSandbox: event.target.checked })}
                    />
                    {t('stage.strictSandbox')}
                </label>
            </div>
        </section>
    );
}
