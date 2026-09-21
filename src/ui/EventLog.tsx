import { useState } from 'react';
import { useI18n } from '../i18n';
import type { TranslateParams } from '../i18n';

export type EventKind =
    | 'ready'
    | 'loaded'
    | 'lifecycle'
    | 'cta'
    | 'error'
    | 'console'
    | 'patched'
    | 'tuner'
    | 'redirect'
    | 'request';

export interface PreviewEvent {
    id: number;
    at: number;
    kind: EventKind;
    /** Key under `event.` in the dictionary. */
    code: string;
    params?: TranslateParams;
    /** Length of the original value when the shim had to cut it. */
    truncated?: number;
}

interface Props {
    events: PreviewEvent[];
    onClear: () => void;
}

/** Collapsed rows stay two lines tall; the rest is one click away. */
const COLLAPSED_CHARS = 150;

function time(at: number): string {
    const date = new Date(at);
    const pad = (value: number, width = 2) => String(value).padStart(width, '0');
    return `${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function EventLog({ events, onClear }: Props) {
    const { t } = useI18n();
    const [expanded, setExpanded] = useState<Set<number>>(new Set());

    const toggle = (id: number) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    return (
        <div className="panel__body">
            <div className="panel__tools">
                <button className="control" onClick={onClear}>
                    {t('log.clear')}
                </button>
                <span className="panel__hint">{t('log.hint')}</span>
            </div>
            {events.length === 0 ? (
                <div className="panel__empty">{t('log.empty')}</div>
            ) : (
                <ul className="log">
                    {events.map((event) => {
                        const full = t(`event.${event.code}`, event.params);
                        const isOpen = expanded.has(event.id);
                        const long = full.length > COLLAPSED_CHARS;
                        const text = isOpen || !long ? full : `${full.slice(0, COLLAPSED_CHARS)}…`;
                        return (
                            <li className={`log__row log__row--${event.kind}`} key={event.id}>
                                <span className="log__time">{time(event.at)}</span>
                                <span className="log__kind">{t(`log.kind.${event.kind}`)}</span>
                                <span className="log__body">
                                    <span
                                        className={[
                                            'log__text',
                                            long ? 'log__text--clickable' : '',
                                            isOpen ? 'log__text--open' : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                        onClick={long ? () => toggle(event.id) : undefined}
                                        title={long && !isOpen ? t('log.expand') : undefined}
                                    >
                                        {text}
                                    </span>
                                    {event.truncated !== undefined && (
                                        <span className="log__cut">{t('log.truncated', { count: event.truncated })}</span>
                                    )}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
