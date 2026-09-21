export type Theme = 'auto' | 'light' | 'dark';

const THEME_KEY = 'playable-tuner:theme';

/** Light is the default; `auto` is opt-in, so the OS being dark does not surprise anyone. */
export function readTheme(): Theme {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'auto' ? stored : 'light';
}

/** `auto` leaves the attribute off so the prefers-color-scheme rules decide. */
export function applyTheme(theme: Theme): void {
    localStorage.setItem(THEME_KEY, theme);
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
}
