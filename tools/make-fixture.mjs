// Builds public/fixtures/demo.html — a miniature build that follows the same
// contract as a real one (tuning block + VFS), so the tuner can be exercised
// end to end without dragging a 5 MB playable around.
import { deflateRawSync, deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../public/fixtures/demo.html');

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

function png(size, paint) {
    const raw = Buffer.alloc(size * (size * 4 + 1));
    for (let y = 0; y < size; y += 1) {
        const rowStart = y * (size * 4 + 1);
        raw[rowStart] = 0;
        for (let x = 0; x < size; x += 1) {
            const [r, g, b, a] = paint(x, y);
            raw.set([r, g, b, a], rowStart + 1 + x * 4);
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

function wav(seconds, frequency) {
    const rate = 8000;
    const samples = Math.floor(rate * seconds);
    const data = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i += 1) {
        const fade = 1 - i / samples;
        data.writeInt16LE(Math.round(Math.sin((i / rate) * frequency * 2 * Math.PI) * 12000 * fade), i * 2);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
}

function tinyMp4() {
    const box = (type, payload) => {
        const size = Buffer.alloc(4);
        size.writeUInt32BE(8 + payload.length);
        return Buffer.concat([size, Buffer.from(type, 'ascii'), payload]);
    };
    const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom'), Buffer.alloc(4), Buffer.from('isomiso2mp41')]));
    return Buffer.concat([ftyp, box('free', Buffer.alloc(8))]);
}
const logo = png(96, (x, y) => {
    const dx = x - 48;
    const dy = y - 48;
    const inside = dx * dx + dy * dy < 46 * 46;
    return inside ? [255, 209, 102, 255] : [0, 0, 0, 0];
});

// Groups are normalised the way the builder does it (tuning-groups.md §2): every param carries a
// group, `general` collects the ones that declare none, and it comes last. `endcard` is declared
// without params on purpose — the tuner has to show that empty section rather than hide it.
const schema = {
    groups: [
        { id: 'character', label: 'Персонаж', description: 'Всё, что принадлежит герою' },
        { id: 'gameplay', label: 'Геймплей' },
        { id: 'branding', label: 'Брендинг и CTA', collapsed: true },
        { id: 'endcard', label: 'Эндкарда' },
        { id: 'general', label: 'General' },
    ],
    params: [
        { key: 'gameSpeed', type: 'number', label: 'Скорость игры', group: 'gameplay', default: 1, min: 0.25, max: 3, step: 0.25, live: true },
        { key: 'ctaText', type: 'string', label: 'Текст CTA', group: 'branding', default: 'PLAY NOW' },
        { key: 'bgColor', type: 'color', label: 'Фон', group: 'branding', default: '#1b2a4a', live: true },
        { key: 'difficulty', type: 'select', label: 'Сложность', group: 'gameplay', default: 'normal', options: ['easy', 'normal', 'hard'] },
        { key: 'showTutorial', type: 'boolean', label: 'Показывать туториал', group: 'general', default: true },
        { key: 'logoImage', type: 'image', label: 'Логотип', group: 'character', asset: 'db://assets/logo.png' },
        { key: 'winSound', type: 'audio', label: 'Звук победы', group: 'character', asset: 'db://assets/win.wav' },
        { key: 'introClip', type: 'video', label: 'Интро-ролик', group: 'endcard', asset: 'db://assets/intro.mp4' },
    ],
};

const values = { gameSpeed: 1, ctaText: 'PLAY NOW', bgColor: '#1b2a4a', difficulty: 'normal', showTutorial: true };

// fit describes the footprint the sprite occupies in the scene: the runtime redraws any
// replacement into it, which is why swap size no longer matters (contract §4).
const assets = {
    logoImage: {
        file: 'assets/main/native/0f/0f3bb384-demo-logo.png',
        mime: 'image/png',
        fit: { rawWidth: 96, rawHeight: 96, x: 4, y: 4, width: 88, height: 88 },
    },
    winSound: { file: 'assets/main/native/a1/a1c9d200-demo-win.wav', mime: 'audio/wav' },
    introClip: { file: 'assets/main/native/c3/c3ab7712-demo-clip.mp4', mime: 'video/mp4' },
};

// Everything in the payload is base64: a network that scans the document
// rejects an asset held any other way, so text pays that third back through
// raw deflate (e:'z') rather than riding as its own source. The old e:'utf8'
// shape is built inside the test instead — a fixture that still carried one
// would be a build the tuner is supposed to reject.
const engineSource = 'export function boot(){ return "tiny engine, deflated"; }\n'.repeat(40);
const settingsSource = JSON.stringify({ note: 'deflated entry, base64 payload', marker: '<!-- not a comment -->' });
const vfs = {
    [assets.logoImage.file]: { t: 'image/png', d: logo.toString('base64') },
    [assets.winSound.file]: { t: 'audio/wav', d: wav(0.4, 660).toString('base64') },
    // A tiny mp4 so the panel has a video slot to show; the bytes are just a valid ftyp header.
    [assets.introClip.file]: { t: 'video/mp4', d: tinyMp4().toString('base64') },
    'src/engine.js': {
        t: 'text/javascript',
        d: deflateRawSync(Buffer.from(engineSource, 'utf-8'), { level: 9 }).toString('base64'),
        e: 'z',
    },
    'src/settings.json': {
        t: 'application/json',
        d: deflateRawSync(Buffer.from(settingsSource, 'utf-8'), { level: 9 }).toString('base64'),
        e: 'z',
    },
};

// Both sequences would end the surrounding <script> early (contract §4).
const escape = (json) =>
    json.replace(/<\/(script)/gi, (_match, tag) => `<\\/${tag}`).replace(/<!--/g, '<\\u0021--');

const game = `
var tuning = window.__TUNING__ || {};
var fs = window.__PLAYABLE_FS__ || {};
var assets = window.__TUNING_ASSETS__ || {};

function dataUrl(key) {
    var ref = assets[key];
    var entry = ref && fs[ref.file];
    return entry ? 'data:' + entry.t + ';base64,' + entry.d : '';
}

var root = document.getElementById('app');
var logo = document.getElementById('logo');
var cta = document.getElementById('cta');
var readout = document.getElementById('readout');
var win = document.getElementById('win');
var sound = new Audio(dataUrl('winSound'));

function render() {
    document.body.style.background = tuning.bgColor || '#1b2a4a';
    cta.textContent = tuning.ctaText || 'PLAY NOW';
    readout.textContent =
        'speed ' + tuning.gameSpeed + ' · ' + tuning.difficulty + ' · tutorial ' + (tuning.showTutorial ? 'on' : 'off');
    logo.style.animationDuration = 6 / (tuning.gameSpeed || 1) + 's';
}

logo.src = dataUrl('logoImage');
render();
window.addEventListener('playable:tuning', function (event) {
    tuning = window.__TUNING__;
    render();
});

window.playable && window.playable.loading();
window.addEventListener('load', function () {
    window.playable && window.playable.loaded();
    window.playable && window.playable.start();
});
root.addEventListener('pointerdown', function () { window.playable && window.playable.interaction(); });
win.addEventListener('click', function () {
    sound.currentTime = 0;
    sound.play().catch(function () {});
    window.playable && window.playable.win();
});
cta.addEventListener('click', function () { window.openStore(); });
`;

const html = `<!DOCTYPE html>
<html>
<head>
<script src="mraid.js"></script>
<script>
window.playable = {
    loading: function () {}, loaded: function () {}, start: function () {}, interaction: function () {},
    progress: function () {}, win: function () {}, lose: function () {}, retry: function () {}, end: function () {}, cta: function () {}
};
window.openStore = function () {
    var url = 'https://play.google.com/store/apps/details?id=com.demo.playable';
    if (window.playable) window.playable.cta();
    if (typeof mraid !== 'undefined') { mraid.open(url); } else { window.open(url, '_blank'); }
};
</script>
<script id="playable-tuning">
/*__PLAYABLE_TUNING_START__*/
window.__TUNING__ = ${escape(JSON.stringify(values))};
window.__TUNING_SCHEMA__ = ${escape(JSON.stringify(schema))};
window.__TUNING_ASSETS__ = ${escape(JSON.stringify(assets))};
/*__PLAYABLE_TUNING_END__*/
</script>
<script>window.__PLAYABLE_FS__ = ${escape(JSON.stringify(vfs))};</script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,user-scalable=no,initial-scale=1">
<title>Demo Playable</title>
<style>
html, body { margin: 0; height: 100%; overflow: hidden; font-family: -apple-system, system-ui, sans-serif; color: #fff; }
#app { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
#logo { width: 38%; max-width: 220px; animation: spin 6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
#readout { font-size: 12px; opacity: .75; }
#size { font-size: 11px; opacity: .5; }
button { font: inherit; border: 0; border-radius: 999px; padding: 12px 28px; font-weight: 700; cursor: pointer; }
#cta { background: #ffd166; color: #20160a; }
#win { background: rgba(255,255,255,.15); color: #fff; padding: 8px 18px; font-size: 12px; }
</style>
</head>
<body>
<div id="app">
    <img id="logo" alt="logo">
    <div id="readout"></div>
    <button id="cta">PLAY NOW</button>
    <button id="win">win()</button>
    <div id="size"></div>
</div>
<script>
function reportSize() {
    document.getElementById('size').textContent =
        window.innerWidth + ' × ' + window.innerHeight + ' · dpr ' + (window.devicePixelRatio || 1);
}
window.addEventListener('resize', reportSize);
window.addEventListener('orientationchange', reportSize);
reportSize();
</script>
<script>${game}</script>
</body>
</html>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html, 'utf-8');
console.log(`fixture written: ${out} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
