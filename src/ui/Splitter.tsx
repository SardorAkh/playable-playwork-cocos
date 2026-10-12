import { useCallback, useRef } from 'react';
import { useI18n } from '../i18n';

interface SplitterProps {
    /** Current width of the panel to the right of the handle, in px. */
    width: number;
    min: number;
    max: number;
    /** Width to return to on a double click. */
    preferred: number;
    onResize: (width: number) => void;
}

const STEP = 16;
const COARSE_STEP = 64;

/**
 * Drag handle between the stage and the side panel.
 *
 * The phone in the stage is a fixed size, so the width left over around it is
 * dead space — on a 1440px window, 687px of it. How much of that the panel
 * should take back depends on what the producer is doing, which is why it is a
 * handle and not a chosen number: a wide panel to work through parameters, a
 * narrow one to watch the playable.
 *
 * It is a real separator, not a decorated div: keyboard users move it with the
 * arrow keys, jump to either extreme with Home and End, and a double click
 * returns it to the default.
 */
export function Splitter({ width, min, max, preferred, onResize }: SplitterProps) {
    const { t } = useI18n();
    const dragging = useRef(false);

    const clamp = useCallback((value: number) => Math.min(max, Math.max(min, value)), [min, max]);

    const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        // Captured so the drag survives the pointer leaving the handle, which it
        // does immediately — the handle is 6px wide and the gesture is 300px long.
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
    }, []);

    const onPointerMove = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (!dragging.current) return;
            event.preventDefault();
            onResize(clamp(window.innerWidth - event.clientX));
        },
        [clamp, onResize],
    );

    const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
    }, []);

    const onKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
            // Left widens the panel, because the panel is the thing on the right:
            // the handle moves the way the key points.
            const step = event.shiftKey ? COARSE_STEP : STEP;
            const next =
                event.key === 'ArrowLeft' ? width + step
                : event.key === 'ArrowRight' ? width - step
                : event.key === 'Home' ? max
                : event.key === 'End' ? min
                : null;
            if (next === null) return;
            event.preventDefault();
            onResize(clamp(next));
        },
        [clamp, max, min, onResize, width],
    );

    return (
        <div
            className="splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('splitter.label')}
            aria-valuenow={Math.round(width)}
            aria-valuemin={min}
            aria-valuemax={max}
            tabIndex={0}
            title={t('splitter.hint')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => onResize(preferred)}
            onKeyDown={onKeyDown}
        >
            <span className="splitter__grip" aria-hidden="true" />
        </div>
    );
}
