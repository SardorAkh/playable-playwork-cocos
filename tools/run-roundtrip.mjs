// Bundles the round-trip test (TypeScript, extensionless imports) and runs it in Node.
import { build } from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = resolve(here, '../node_modules/.cache/playable-tuner');
mkdirSync(cacheDir, { recursive: true });
const outfile = join(cacheDir, 'roundtrip.mjs');

// `?raw` is Vite's; esbuild needs telling. The tuner uses it to inline pako's
// inflater into a repacked export, so the test has to resolve it the same way.
const rawImports = {
    name: 'raw-imports',
    setup(api) {
        api.onResolve({ filter: /\?raw$/ }, (args) => ({
            path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')).replace(
                /^(?!\/)/, '',
            ),
            namespace: 'raw',
            pluginData: { spec: args.path.replace(/\?raw$/, ''), dir: args.resolveDir },
        }));
        api.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => {
            const { spec, dir } = args.pluginData;
            const resolved = await api.resolve(spec, { resolveDir: dir, kind: 'import-statement' });
            if (resolved.errors.length) return { errors: resolved.errors };
            return { contents: readFileSync(resolved.path, 'utf-8'), loader: 'text' };
        });
    },
};

await build({
    plugins: [rawImports],
    entryPoints: [resolve(here, 'roundtrip-test.mts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: ['jszip'],
    outfile,
    absWorkingDir: resolve(here, '..'),
});

await import(pathToFileURL(outfile).href);
