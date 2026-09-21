import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    // Relative asset paths, so the same build works at a domain root and under
    // https://<user>.github.io/<repo>/ without knowing the repository name.
    base: './',
    server: { port: 5183, host: '127.0.0.1' },
    build: { target: 'es2020' },
});
