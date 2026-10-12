import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n';

/**
 * Collapsing and jumping between categories, shared by the parameters and the
 * assets panel.
 *
 * It lives here because it already drifted once: the parameters panel grew
 * collapsible headers and a jump list while the assets panel kept static ones,
 * so the same 17 categories behaved differently depending on which tab you
 * were on. Two copies of this would drift again.
 */

export interface GroupLike {
    id: string;
    title: string;
}

/** The dom id a jump scrolls to. Prefixed, because both panels are mounted. */
export function groupDomId(prefix: string, id: string): string {
    return `${prefix}-group-${id}`;
}

function read(key: string): Record<string, boolean> {
    try {
        return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, boolean>;
    } catch {
        return {};
    }
}

/**
 * Which categories are shut, remembered across reloads: it is a working
 * preference, and losing it on every refresh is what made both panels reopen
 * at full height every time.
 */
export function useClosedGroups(storageKey: string) {
    const [closed, setClosed] = useState<Record<string, boolean>>(() => read(storageKey));

    useEffect(() => localStorage.setItem(storageKey, JSON.stringify(closed)), [storageKey, closed]);

    const toggle = useCallback((id: string) => setClosed((prev) => ({ ...prev, [id]: !prev[id] })), []);
    const open = useCallback((id: string) => setClosed((prev) => ({ ...prev, [id]: false })), []);
    const collapseAll = useCallback(
        (groups: GroupLike[]) => setClosed(Object.fromEntries(groups.map((group) => [group.id, true]))),
        [],
    );
    const expandAll = useCallback(() => setClosed({}), []);

    /**
     * Applies a build's own `collapsed` hints, but only to categories the
     * producer has no opinion about yet. The hint says how the category should
     * look the first time it is seen; after that the remembered state wins, or
     * reopening a build would undo every collapse they made in it.
     */
    const seed = useCallback((hints: Record<string, boolean>) => {
        setClosed((prev) => {
            const next = { ...prev };
            let changed = false;
            for (const [id, value] of Object.entries(hints)) {
                if (id in next) continue;
                next[id] = value;
                changed = true;
            }
            return changed ? next : prev;
        });
    }, []);

    return { closed, toggle, open, collapseAll, expandAll, seed };
}

interface GroupNavProps {
    groups: GroupLike[];
    /** Shown next to each title; the panels count different things. */
    countOf: (group: GroupLike) => number;
    domIdPrefix: string;
    onOpen: (id: string) => void;
    onCollapseAll: () => void;
    onExpandAll: () => void;
}

export function GroupNav({ groups, countOf, domIdPrefix, onOpen, onCollapseAll, onExpandAll }: GroupNavProps) {
    const { t } = useI18n();
    if (groups.length < 2) return null;

    return (
        <div className="panel__tools">
            <select
                className="control"
                aria-label={t('params.jumpLabel')}
                value=""
                onChange={(event) => {
                    const id = event.target.value;
                    if (!id) return;
                    // Opened before the scroll: jumping to a shut category and
                    // landing on a closed header is a dead end.
                    onOpen(id);
                    requestAnimationFrame(() =>
                        document.getElementById(groupDomId(domIdPrefix, id))?.scrollIntoView({ block: 'start' }),
                    );
                }}
            >
                <option value="">{t('params.jumpTo')}</option>
                {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                        {group.title} ({countOf(group)})
                    </option>
                ))}
            </select>
            <button className="control" onClick={onCollapseAll}>
                {t('params.collapseAll')}
            </button>
            <button className="control" onClick={onExpandAll}>
                {t('params.expandAll')}
            </button>
        </div>
    );
}

interface GroupHeadProps {
    title: string;
    count: number;
    closed: boolean;
    onToggle: () => void;
}

export function GroupHead({ title, count, closed, onToggle }: GroupHeadProps) {
    return (
        <button className="section__head" aria-expanded={!closed} onClick={onToggle}>
            <span className={closed ? 'section__arrow' : 'section__arrow is-open'}>▸</span>
            <span className="section__title">{title}</span>
            <span className="section__count">{count}</span>
        </button>
    );
}
