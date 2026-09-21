import { useI18n } from '../i18n';
import { NETWORKS, formatBytes } from '../core/networks';
import type { LoadedBuild } from '../core/types';
import type { NetworkCheck } from './ExportPanel';

interface Props {
    build: LoadedBuild;
    checks: NetworkCheck[];
    checkedAt: number | null;
    busy: boolean;
    onRecheck: () => void;
}

export function IssuesPanel({ build, checks, checkedAt, busy, onRecheck }: Props) {
    const { t } = useI18n();

    return (
        <div className="panel__body">
            <div className="panel__tools">
                <button className="control control--primary" onClick={onRecheck} disabled={busy}>
                    {t('issues.check')}
                </button>
                {checkedAt === null && <span className="panel__hint">{t('issues.notChecked')}</span>}
            </div>

            {checks.length === 0 && <div className="panel__empty">{t('issues.press')}</div>}

            {checks.map((check) => {
                const network = NETWORKS.find((item) => item.id === check.networkId);
                if (!network) return null;
                const usage = Math.min(1, check.sizeBytes / network.maxBytes);
                return (
                    <div className="group" key={check.networkId}>
                        <div className="group__head">
                            <span className="field__label">{network.label}</span>
                            <span className="panel__hint">
                                {t('issues.size', {
                                    size: formatBytes(check.sizeBytes),
                                    limit: formatBytes(network.maxBytes),
                                    source: formatBytes(build.sourceBytes),
                                    format: network.format,
                                })}
                            </span>
                        </div>
                        <div className="meter">
                            <div
                                className={usage > 0.9 ? 'meter__fill meter__fill--hot' : 'meter__fill'}
                                style={{ width: `${usage * 100}%` }}
                            />
                        </div>
                        {check.issues.length === 0 ? (
                            <div className="panel__hint">{t('issues.clean')}</div>
                        ) : (
                            <ul className="issues">
                                {check.issues.map((issue, index) => (
                                    <li className={`issue issue--${issue.severity}`} key={`${issue.code}-${index}`}>
                                        <span className="issue__badge">{t(`issues.${issue.severity}`)}</span>
                                        <span>{t(`issue.${issue.code}`, issue.params)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="panel__hint">
                            {t('issues.signatures', { date: network.signaturesCheckedAt, cta: network.ctaSymbol })}
                        </div>
                    </div>
                );
            })}

            {build.notes.length > 0 && (
                <ul className="issues">
                    {build.notes.map((note) => (
                        <li className="issue issue--note" key={note}>
                            <span className="issue__badge">{t('issues.note')}</span>
                            <span>{t(`note.${note}`)}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
