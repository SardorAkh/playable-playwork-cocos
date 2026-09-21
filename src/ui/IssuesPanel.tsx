import { useMemo } from 'react';
import { useI18n } from '../i18n';
import { NETWORKS, formatBytes } from '../core/networks';
import type { LoadedBuild, ValidationIssue } from '../core/types';
import type { NetworkCheck } from './ExportPanel';

interface Props {
    build: LoadedBuild;
    checks: NetworkCheck[];
    checkedAt: number | null;
    busy: boolean;
    onRecheck: () => void;
}

/** Parameters that only name the network a check ran for — not part of what the issue is. */
const NETWORK_PARAMS = ['network', 'symbol', 'limit', 'expected', 'actual'];

/** Wordings without a network in them, used once the issue turns out to be shared. */
const SHARED_ALIAS: Record<string, string> = { redirect: 'redirect-any', 'window-open': 'window-open-any' };

function issueKey(issue: ValidationIssue): string {
    const params = Object.fromEntries(
        Object.entries(issue.params ?? {}).filter(([name]) => !NETWORK_PARAMS.includes(name)),
    );
    return `${issue.code}|${JSON.stringify(params)}`;
}

function IssueList({ issues, shared = false }: { issues: ValidationIssue[]; shared?: boolean }) {
    const { t } = useI18n();
    return (
        <ul className="issues">
            {issues.map((issue, index) => {
                const code = (shared && SHARED_ALIAS[issue.code]) || issue.code;
                return (
                    <li className={`issue issue--${issue.severity}`} key={`${issue.code}-${index}`}>
                        <span className="issue__badge">{t(`issues.${issue.severity}`)}</span>
                        <span>{t(`issue.${code}`, issue.params)}</span>
                    </li>
                );
            })}
        </ul>
    );
}

export function IssuesPanel({ build, checks, checkedAt, busy, onRecheck }: Props) {
    const { t } = useI18n();

    /**
     * Most findings come from the game itself, so every network repeats them — eight copies of the
     * same redirect warning read as a wall of problems. They are stated once, and each network keeps
     * only what is actually specific to it (size, missing SDK symbol, format).
     */
    const { shared, perNetwork } = useMemo(() => {
        if (checks.length < 2) return { shared: [] as ValidationIssue[], perNetwork: checks };
        const counts = new Map<string, { issue: ValidationIssue; networks: number }>();
        for (const check of checks) {
            for (const key of new Set(check.issues.map(issueKey))) {
                const issue = check.issues.find((item) => issueKey(item) === key)!;
                const seen = counts.get(key);
                counts.set(key, { issue, networks: (seen?.networks ?? 0) + 1 });
            }
        }
        const sharedKeys = new Set(
            [...counts.entries()].filter(([, value]) => value.networks === checks.length).map(([key]) => key),
        );
        return {
            shared: [...counts.values()].filter(({ issue }) => sharedKeys.has(issueKey(issue))).map(({ issue }) => issue),
            perNetwork: checks.map((check) => ({
                ...check,
                issues: check.issues.filter((issue) => !sharedKeys.has(issueKey(issue))),
            })),
        };
    }, [checks]);

    return (
        <div className="panel__body">
            <div className="panel__tools">
                <button className="control control--primary" onClick={onRecheck} disabled={busy}>
                    {t('issues.check')}
                </button>
                {checkedAt === null && <span className="panel__hint">{t('issues.notChecked')}</span>}
            </div>

            {checks.length === 0 && <div className="panel__empty">{t('issues.press')}</div>}

            {shared.length > 0 && (
                <div className="group">
                    <div className="group__head">
                        <span className="field__label">{t('issues.shared')}</span>
                        <span className="panel__hint">{t('issues.sharedHint', { count: checks.length })}</span>
                    </div>
                    <IssueList issues={shared} shared />
                </div>
            )}

            {perNetwork.map((check) => {
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
                            <div className="panel__hint">{shared.length > 0 ? t('issues.onlyShared') : t('issues.clean')}</div>
                        ) : (
                            <IssueList issues={check.issues} />
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
