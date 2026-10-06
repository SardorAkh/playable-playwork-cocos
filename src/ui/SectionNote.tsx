import { useState } from 'react';
import type { Translate } from '../i18n';

/**
 * A category's note.
 *
 * Short ones are a line of guidance and render as one. Long ones are
 * something else entirely -- a build can ship instructions here, and for this
 * tuner the most useful thing a build has ever put in a category note is a
 * ready-made prompt for whoever is writing a level. That wants line breaks
 * kept, a way to get it onto the clipboard in one go, and a way to fold it
 * away once it has been used.
 */
const NOTE_FOLD_CHARS = 240;

export function SectionNote({ text, t }: { text: string; t: Translate }) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const long = text.length > NOTE_FOLD_CHARS || text.includes('\n');
    if (!long) return <div className="section__note">{text}</div>;

    const copy = () => {
        void navigator.clipboard
            ?.writeText(text)
            .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => setCopied(false));
    };

    return (
        <div className="section__note section__note--long">
            <div className="section__note-head">
                <button type="button" className="btn btn--ghost btn--tiny" onClick={() => setOpen(!open)}>
                    {open ? t('params.noteLess') : t('params.noteMore')}
                </button>
                <button type="button" className="btn btn--ghost btn--tiny" onClick={copy}>
                    {copied ? t('params.noteCopied') : t('params.noteCopy')}
                </button>
            </div>
            <pre className={open ? 'section__note-text is-open' : 'section__note-text'}>{text}</pre>
        </div>
    );
}
