// Builds public/fixtures/demo-tuner.html — the network-neutral "tuner bundle" from
// tuner-integration.md §8: the same demo game, minus any network SDK, plus the two marked
// blocks (neutral SDK for preview, and a manifest with a wrap recipe per network).
// Run after make-fixture.mjs; `npm run fixture` does both.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../public/fixtures/demo.html');
const out = resolve(here, '../public/fixtures/demo-tuner.html');

const STORE_URL = 'https://play.google.com/store/apps/details?id=com.demo.playable';
const CLOSE = '</' + 'script>';

const NETWORKS = [
    { id: 'applovin', displayName: 'AppLovin', shortName: 'AL', format: 'html', cta: 'mraid.open(url)', mraid: true },
    { id: 'unity', displayName: 'Unity Ads', shortName: 'UNITY', format: 'html', cta: 'mraid.open(url)', mraid: true },
    { id: 'ironsource', displayName: 'IronSource', shortName: 'IS', format: 'html', cta: 'dapi.openStoreUrl(url)', mraid: true },
    { id: 'meta', displayName: 'Meta', shortName: 'FB', format: 'html', cta: 'FbPlayableAd.onCTAClick()', mraid: false },
    { id: 'liftoff', displayName: 'Liftoff', shortName: 'LIFTOFF', format: 'html', cta: 'mraid.open(url)', mraid: true },
    { id: 'mintegral', displayName: 'Mintegral', shortName: 'MINTEGRAL', format: 'zip', cta: 'mraid.open(url)', mraid: true },
    { id: 'google', displayName: 'Google', shortName: 'GOOGLE', format: 'zip', cta: 'ExitApi.exit()', mraid: false },
    { id: 'tiktok', displayName: 'TikTok', shortName: 'TIKTOK', format: 'zip', cta: 'mraid.open(url)', mraid: true },
];

const escape = (json) => json.replace(/<\/script/gi, '<\\/script');

function headHtml(network) {
    const lines = [];
    if (network.mraid) lines.push('<script src="mraid.js">' + CLOSE);
    lines.push('<script>');
    lines.push('window.openStore = function () {');
    lines.push("    var url = '" + STORE_URL + "';");
    lines.push('    if (window.playable) window.playable.cta();');
    lines.push('    ' + network.cta + ';');
    lines.push('};');
    lines.push(CLOSE);
    return lines.join('\n');
}

function recipe(network) {
    const zipEntries =
        network.id === 'mintegral'
            ? [
                  {
                      path: 'config.json',
                      content: JSON.stringify({ orientation: 'responsive', playable_languages: ['en'] }),
                      encoding: 'utf-8',
                  },
              ]
            : [];
    return {
        id: network.id,
        displayName: network.displayName,
        shortName: network.shortName,
        format: network.format,
        maxSizeBytes: 5 * 1024 * 1024,
        fileName: `Demo_v1_20260916_${network.shortName}.${network.format}`,
        headHtml: headHtml(network),
        bodyEndHtml: '',
        zipEntries,
    };
}

const manifest = {
    builder: 'playable-builder',
    contract: 1,
    generatedAt: new Date().toISOString(),
    app: 'Demo Playable',
    version: 'v1',
    date: '20260916',
    language: 'en',
    orientation: 'responsive',
    storeUrls: { android: STORE_URL, ios: '' },
    networks: NETWORKS.map(recipe),
};

const neutralSdk = [
    '<script>',
    'window.openStore = function () {',
    "    var url = '" + STORE_URL + "';",
    '    if (window.playable) window.playable.cta();',
    "    window.open(url, '_blank');",
    '};',
    CLOSE,
].join('\n');

const blocks = [
    '<!--__PLAYABLE_NEUTRAL_SDK_START__-->',
    neutralSdk,
    '<!--__PLAYABLE_NEUTRAL_SDK_END__-->',
    '<!--__PLAYABLE_MANIFEST_START__-->',
    '<script id="playable-manifest">',
    `window.__PLAYABLE_MANIFEST__ = ${escape(JSON.stringify(manifest))};`,
    CLOSE,
    '<!--__PLAYABLE_MANIFEST_END__-->',
].join('\n');

const demo = readFileSync(source, 'utf-8');
// The bundle knows nothing about any network: drop the mraid tag and the SDK-aware CTA.
const neutralGame = demo
    .replace('<script src="mraid.js">' + CLOSE + '\n', '')
    .replace(/window\.openStore = function \(\) \{[\s\S]*?\n\};\n/, '');

const bundle = neutralGame.replace(/<head[^>]*>/i, (match) => `${match}\n${blocks}`);

writeFileSync(out, bundle, 'utf-8');
console.log(`bundle written: ${out} (${(Buffer.byteLength(bundle) / 1024).toFixed(1)} KB)`);
