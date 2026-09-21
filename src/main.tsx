import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { I18nProvider, readLang } from './i18n';
import { applyTheme, readTheme } from './theme';
import './styles.css';

applyTheme(readTheme());
document.documentElement.lang = readLang();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <I18nProvider>
            <App />
        </I18nProvider>
    </StrictMode>,
);
