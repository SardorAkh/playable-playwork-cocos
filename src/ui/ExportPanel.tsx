import { useI18n } from '../i18n';
import { NETWORKS, formatBytes } from '../core/networks';
import { ORIENTATIONS, canFeed, planExport, targetFormat } from '../core/export';
import type { ExportSettings, ExportSourceInfo, NetworkTarget, OrientationTarget } from '../core/export';
import type { ValidationIssue } from '../core/types';

export interface NetworkCheck {
    networkId: string;
    sizeBytes: number;
    issues: ValidationIssue[];
}

export interface SourceInfo extends ExportSourceInfo {
    fileName: string;
}

interface Props {
    sources: SourceInfo[];
    settings: ExportSettings;
    checks: NetworkCheck[];
    busy: boolean;
    onChange: (settings: ExportSettings) => void;
    onValidateAll: () => void;
}

export function ExportPanel({ sources, settings, checks, busy, onChange, onValidateAll }: Props) {
    const { t } = useI18n();

    const patchNetwork = (networkId: string, patch: Partial<NetworkTarget>) =>
        onChange({
            ...settings,
            networks: settings.networks.map((item) => (item.networkId === networkId ? { ...item, ...patch } : item)),
        });

    const patchOrientation = (orientation: string, patch: Partial<OrientationTarget>) =>
        onChange({
            ...settings,
            orientations: settings.orientations.map((item) =>
                item.orientation === orientation ? { ...item, ...patch } : item,
            ),
        });

    const items = planExport(settings, NETWORKS, sources);

    return (
        <div className="panel__body">
            <div className="field">
                <div className="field__head">
                    <span className="field__label">{t('export.baseName')}</span>
                </div>
                <input
                    className="control control--wide"
                    value={settings.baseName}
                    onChange={(event) => onChange({ ...settings, baseName: event.target.value })}
                />
            </div>

            <div className="group">
                <div className="group__head">
                    <span className="field__label">{t('export.networks')}</span>
                    <button className="control" onClick={onValidateAll} disabled={busy || items.length === 0}>
                        {t('export.validateAll')}
                    </button>
                </div>

                {settings.networks.map((target) => {
                    const profile = NETWORKS.find((network) => network.id === target.networkId)!;
                    const usable = sources.filter((source) => canFeed(source, profile));
                    const chosen = sources.find((source) => source.id === target.sourceId);
                    const check = checks.find((item) => item.networkId === target.networkId);
                    const errors = check?.issues.filter((issue) => issue.severity === 'error').length ?? 0;
                    const warnings = check?.issues.filter((issue) => issue.severity === 'warning').length ?? 0;
                    const mismatch = chosen && !chosen.bundle && chosen.networkId !== target.networkId;

                    return (
                        <div className={target.enabled ? 'target target--on' : 'target'} key={target.networkId}>
                            <div className="target__head">
                                <label className="check check--strong">
                                    <input
                                        type="checkbox"
                                        checked={target.enabled}
                                        disabled={usable.length === 0}
                                        onChange={(event) =>
                                            patchNetwork(target.networkId, {
                                                enabled: event.target.checked,
                                                // Ticking a network should just work: adopt the build shown in the picker.
                                                sourceId: target.sourceId ?? usable[0]?.id ?? null,
                                            })
                                        }
                                    />
                                    {profile.label}
                                    {chosen?.bundle && (
                                        <span className="pill pill--live">.{targetFormat(chosen, profile)}</span>
                                    )}
                                </label>
                                <span className="target__status">
                                    {check ? (
                                        <>
                                            <span>{formatBytes(check.sizeBytes)}</span>
                                            <span className={errors > 0 ? 'pill pill--error' : warnings > 0 ? 'pill pill--warn' : 'pill pill--ok'}>
                                                {errors + warnings === 0
                                                    ? t('export.ok')
                                                    : t('export.counts', { errors, warnings })}
                                            </span>
                                        </>
                                    ) : (
                                        <span className="panel__hint">{t('export.notChecked')}</span>
                                    )}
                                </span>
                            </div>

                            {usable.length === 0 ? (
                                <div className="target__note">{t('export.noSource')}</div>
                            ) : (
                                <div className="target__row">
                                    <label className="mini">
                                        {t('export.folder')}
                                        <input
                                            className="control control--mini control--text"
                                            value={target.folder}
                                            onChange={(event) => patchNetwork(target.networkId, { folder: event.target.value })}
                                        />
                                    </label>
                                    <label className="mini">
                                        {t('export.suffix')}
                                        <input
                                            className="control control--mini control--text"
                                            value={target.suffix}
                                            onChange={(event) => patchNetwork(target.networkId, { suffix: event.target.value })}
                                        />
                                    </label>
                                    <label className="mini mini--grow">
                                        {t('export.source')}
                                        <select
                                            className="control control--mini"
                                            value={target.sourceId ?? usable[0]?.id ?? ''}
                                            onChange={(event) => patchNetwork(target.networkId, { sourceId: event.target.value })}
                                        >
                                            {usable.map((source) => (
                                                <option key={source.id} value={source.id}>
                                                    {source.bundle ? `${source.fileName} · bundle` : source.fileName}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                            )}

                            {mismatch && (
                                <div className="target__note target__note--warn">
                                    {t('export.mismatch', {
                                        network: NETWORKS.find((network) => network.id === chosen.networkId)?.label ?? '?',
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="group">
                <div className="group__head">
                    <span className="field__label">{t('export.orientations')}</span>
                </div>
                {ORIENTATIONS.map((orientation) => {
                    const target = settings.orientations.find((item) => item.orientation === orientation)!;
                    return (
                        <div className="target__row" key={orientation}>
                            <label className="check check--strong mini--grow">
                                <input
                                    type="checkbox"
                                    checked={target.enabled}
                                    onChange={(event) => patchOrientation(orientation, { enabled: event.target.checked })}
                                />
                                {t(`orientation.${orientation}`)}
                            </label>
                            <label className="mini">
                                {t('export.suffix')}
                                <input
                                    className="control control--mini control--text"
                                    value={target.suffix}
                                    onChange={(event) => patchOrientation(orientation, { suffix: event.target.value })}
                                />
                            </label>
                        </div>
                    );
                })}
                <div className="panel__hint">{t('export.orientationHint')}</div>
            </div>

            <div className="group">
                <div className="group__head">
                    <span className="field__label">{t('export.output', { count: items.length })}</span>
                </div>
                {items.length === 0 ? (
                    <div className="panel__empty">{t('export.empty')}</div>
                ) : (
                    <ul className="tree">
                        {items.map((item) => (
                            <li className={item.mismatched ? 'tree__row tree__row--warn' : 'tree__row'} key={item.path}>
                                <code>{item.path}</code>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
