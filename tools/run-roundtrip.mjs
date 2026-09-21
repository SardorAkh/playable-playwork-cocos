// Bundles the round-trip test (TypeScript, extensionless imports) and runs it in Node.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = resolve(here, '../node_modules/.cache/playable-tuner');
mkdirSync(cacheDir, { recursive: true });
const outfile = join(cacheDir, 'roundtrip.mjs');

await build({
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
