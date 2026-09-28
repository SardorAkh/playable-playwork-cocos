// Round-trip check for the build contract: parse a build, edit values and an asset,
// re-serialize, parse the result again and compare. Run with: npm test
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { composeHtml, loadBuild, serialize } from '../src/core/bundle.ts';
import { bytesToBase64, base64ToBytes } from '../src/core/base64.ts';
import { NETWORKS } from '../src/core/networks.ts';
import { validate } from '../src/core/validate.ts';
import { isAssetParam, isFlat, isSwappable, matchesQuery, matchesSection, sectionsOf } from '../src/core/schema.ts';
import { formatDuration, probeMedia } from '../src/core/media.ts';
import { entryByteLength, entryBytes, entryText, isTextEntry, withBytes } from '../src/core/vfs.ts';
import { escapeForScript, unescapeFromScript } from '../src/core/text.ts';
import {
    DEFAULT_ORIENTATION_SUFFIX,
    ORIENTATIONS,
    buildArtifact,
    canFeed,
    packExport,
    planExport,
    suggestBaseName,
    targetFormat,
} from '../src/core/export.ts';
import type { ExportSettings, ExportSourceInfo } from '../src/core/export.ts';

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
    if (condition) {
        console.log(`  ok   ${label}`);
        return;
    }
    failures += 1;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}

const source = readFileSync(resolve(process.cwd(), 'public/fixtures/demo.html'));
const build = await loadBuild(new File([source], 'demo.html', { type: 'text/html' }));

console.log('parse');
check('tuning block found', build.hasTuningBlock);
check('schema has 8 params', build.schema?.params.length === 8, build.schema?.params.length);
check('three swappable assets', Object.keys(build.assets).length === 3, Object.keys(build.assets));
check('vfs parsed', Object.keys(build.vfs ?? {}).length === 4, Object.keys(build.vfs ?? {}));
check('default value read', build.values.ctaText === 'PLAY NOW', build.values.ctaText);

console.log('groups');
const sections = sectionsOf(build.schema);
check(
    'sections follow the schema order, general last',
    sections.map((section) => section.id).join(' ') === 'character gameplay branding endcard general',
    sections.map((section) => section.id),
);
check('section titles come from label', sections[0].title === 'Персонаж', sections[0].title);
check('description rides along', sections[0].description.startsWith('Всё, что'), sections[0].description);
check('collapsed is a hint the tuner can honour', sections[2].collapsed === true);
check('params land in their category', sections[1].params.map((p) => p.key).join(',') === 'gameSpeed,difficulty');
check('the endcard category now holds the video slot', sections[3].params.map((p) => p.key).join(',') === 'introClip', sections[3].params.map((p) => p.key));
check('a param without a group falls into general', sections[4].params.map((p) => p.key).join(',') === 'showTutorial');
check('assets sit in the same categories as params', sections[0].params.map((p) => p.type).join(',') === 'image,audio');
check('every param is placed exactly once', sections.reduce((total, s) => total + s.params.length, 0) === 8);

const legacy = sectionsOf({ params: [{ key: 'a', type: 'string' }, { key: 'b', type: 'number' }] });
check('a schema without groups collapses into one general section', legacy.length === 1 && legacy[0].id === 'general', legacy.map((s) => s.id));
check('a single section counts as flat', isFlat(legacy));
check('a grouped schema is not flat', !isFlat(sections));

const undeclared = sectionsOf({
    groups: [{ id: 'known', label: 'Known' }],
    params: [{ key: 'x', type: 'string', group: 'ghost' }, { key: 'y', type: 'string', group: 'known' }],
});
check('an undeclared group is synthesised rather than dropped', undeclared.map((s) => s.id).join(' ') === 'known ghost', undeclared.map((s) => s.id));
check('nothing is lost when a group is unknown', undeclared.flatMap((s) => s.params).length === 2);

const badId = sectionsOf({ groups: [], params: [{ key: 'z', type: 'string', group: 'not a valid id' }] });
check('an invalid group id falls back to general', badId.length === 1 && badId[0].params[0].key === 'z');

const searchSection = sections[0];
check('search covers label, key and category title', matchesQuery(searchSection.params[0], searchSection, 'персонаж'));
check('search matches the param key too', matchesQuery(searchSection.params[0], searchSection, 'logoimage'));
check('search rejects what does not match', !matchesQuery(searchSection.params[0], searchSection, 'zzz'));
check('search reaches the category description', matchesQuery(searchSection.params[0], searchSection, 'герою'));
check('a category matches on its own text', matchesSection(sections[1], 'геймплей') && !matchesSection(sections[1], 'персонаж'));

check('a declared asset in the build is swappable', isSwappable(build.schema!.params.find((p) => p.key === 'logoImage')!, build.assets));
check('a video slot counts as an asset param', isAssetParam({ key: 'introClip', type: 'video' }));
check('a video slot present in the map is swappable', isSwappable(build.schema!.params.find((p) => p.key === 'introClip')!, build.assets));

check('an asset missing from the map is not swappable', !isSwappable({ key: 'ghostAsset', type: 'image' }, build.assets));

console.log('vfs encodings and escaping');
const textEntry = build.vfs!['src/settings.json'];
check('a utf8 entry is flagged', isTextEntry(textEntry), textEntry?.e);
check('its payload is the file text, not base64', entryText(textEntry).startsWith('{"note"'), entryText(textEntry).slice(0, 20));
check('utf8 bytes are measured, not base64-decoded', entryByteLength(textEntry) === Buffer.byteLength(textEntry.d));
check('a binary entry still decodes from base64', entryBytes(build.vfs![build.assets.logoImage.file])[1] === 0x50);
check('a comment opener survives the round-trip', JSON.parse(entryText(textEntry)).marker === '<!-- not a comment -->');
check('the raw payload carries no comment opener', !/window\.__PLAYABLE_FS__[^\n]*<!--/.test(build.html));
check('a swap keeps t and e untouched', (() => {
    const swapped = withBytes(textEntry, new TextEncoder().encode('{"x":1}'));
    return swapped.t === textEntry.t && swapped.e === textEntry.e;
})());

const roundTrip = JSON.parse(unescapeFromScript(escapeForScript(JSON.stringify({ a: '</SCRIPT>', b: '<!--' }))));
check('script tag keeps its case through the escape', roundTrip.a === '</SCRIPT>', roundTrip.a);
check('comment opener round-trips', roundTrip.b === '<!--');
check('JSON.parse alone resolves both escapes', JSON.parse(escapeForScript(JSON.stringify({ b: '<!--' }))).b === '<!--');

console.log('asset fit');
check('image slots carry their footprint', build.assets.logoImage.fit?.rawWidth === 96, build.assets.logoImage.fit);
check('audio slots carry none', build.assets.winSound.fit === undefined);

console.log('media probes');
const logoBytes = base64ToBytes(build.vfs![build.assets.logoImage.file].d);
const logoMeta = probeMedia(logoBytes, logoBytes.length, 'image/png');
check('png resolution is read from the header', logoMeta.width === 96 && logoMeta.height === 96, logoMeta);
check('png format is named', logoMeta.format === 'PNG');

const wavBytes = base64ToBytes(build.vfs![build.assets.winSound.file].d);
const wavMeta = probeMedia(wavBytes, wavBytes.length, 'audio/wav');
check('wav sample rate and channels are read', wavMeta.sampleRate === 8000 && wavMeta.channels === 1, wavMeta);
check('wav bitrate is derived from the byte rate', wavMeta.bitrateKbps === 128, wavMeta.bitrateKbps);
check('wav duration matches the fixture', Math.abs((wavMeta.durationMs ?? 0) - 400) <= 5, wavMeta.durationMs);
check('duration is formatted for humans', formatDuration(400) === '0:00.4' && formatDuration(65_500) === '1:05.5');

// Only a header slice reaches the probe in the UI; the numbers must survive that.
const header = logoBytes.slice(0, 64);
check('a truncated header is still enough', probeMedia(header, logoBytes.length, 'image/png').width === 96);

const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]);
check('gif dimensions are little-endian', probeMedia(gif, gif.length, 'image/gif').width === 320);

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58]);
const jpegMeta = probeMedia(jpeg, jpeg.length, 'image/jpeg');
check('jpeg frame header gives width and height', jpegMeta.width === 600 && jpegMeta.height === 300, jpegMeta);

const mp4 = base64ToBytes(build.vfs!['assets/main/native/c3/c3ab7712-demo-clip.mp4'].d);
check('mp4 is recognised by its ftyp brand', probeMedia(mp4, mp4.length, 'video/mp4').format === 'MP4', probeMedia(mp4, mp4.length, 'video/mp4'));
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
check('webm is recognised by its EBML magic', probeMedia(webm, webm.length, 'video/webm').format === 'WEBM');
check('matroska keeps its own name', probeMedia(webm, webm.length, 'video/x-matroska').format === 'MKV');

check('an unknown blob probes to nothing rather than throwing', Object.keys(probeMedia(new Uint8Array([1, 2, 3, 4]), 4, 'application/octet-stream')).length === 0);

console.log('edit');
const logoPath = build.assets.logoImage.file;
const newLogo = new Uint8Array(512).fill(7);
const values = {
    ...build.values,
    ctaText: 'ЖМИ </script><script>alert(1)</script>',
    gameSpeed: 2.5,
    bgColor: '#ff0000',
};
const edited = composeHtml(build, values, { [logoPath]: { t: 'image/png', d: bytesToBase64(newLogo) } });

const reparsed = await loadBuild(new File([edited], 'demo.html', { type: 'text/html' }));
check('value survives round-trip', reparsed.values.ctaText === values.ctaText, reparsed.values.ctaText);
check('number survives round-trip', reparsed.values.gameSpeed === 2.5, reparsed.values.gameSpeed);
check('schema untouched', JSON.stringify(reparsed.schema) === JSON.stringify(build.schema));
check(
    'asset bytes swapped',
    base64ToBytes(reparsed.vfs![logoPath].d).every((byte) => byte === 7),
);
check('asset mime kept', reparsed.vfs![logoPath].t === 'image/png');
check('other asset untouched', reparsed.vfs![build.assets.winSound.file].d === build.vfs![build.assets.winSound.file].d);
check('script tag not broken out of', !edited.includes('</script><script>alert(1)'));
check('markers intact', (edited.match(/__PLAYABLE_TUNING_START__/g) ?? []).length === 1);

console.log('validate');
const blob = await serialize(build, edited);
const applovin = NETWORKS.find((network) => network.id === 'applovin')!;
const base = { build, values, sizeBytes: blob.size, assetIssues: [], runtimeRedirects: [], runtimeRequests: [] };
const clean = validate({ ...base, html: edited, network: applovin });
check('no blocking errors on a sane edit', !clean.some((issue) => issue.severity === 'error'), clean);
check('mraid build passes the applovin symbol check', !clean.some((issue) => issue.code === 'missing-symbol'));
check('window.open is only a warning', clean.some((issue) => issue.code === 'window-open' && issue.severity === 'warning'));

const meta = NETWORKS.find((network) => network.id === 'meta')!;
const metaIssues = validate({ ...base, html: edited, network: meta });
check('wrong network misses its CTA symbol', metaIssues.some((issue) => issue.code === 'missing-symbol' && issue.severity === 'error'));

const noSdk = edited.replace(/mraid/g, 'xraid');
const redirectHtml = noSdk.replace('</head>', '<script>window.location.href = "https://example.com";</script></head>');
const redirectIssues = validate({ ...base, build: { ...build, html: redirectHtml }, html: redirectHtml, network: applovin });
check('redirect without an SDK call is an error', redirectIssues.some((issue) => issue.code === 'redirect' && issue.severity === 'error'));
check('missing mraid.js tag is reported', redirectIssues.some((issue) => issue.code === 'missing-mraid'));

const runtime = validate({ ...base, html: edited, network: applovin, runtimeRequests: ['https://tracker.example.com/p.gif'], runtimeRedirects: ['location.assign'] });
check('runtime request is an error', runtime.some((issue) => issue.code === 'runtime-request' && issue.severity === 'error'));
check('runtime redirect is a warning', runtime.some((issue) => issue.code === 'runtime-redirect'));

const oversized = validate({ ...base, html: edited, network: applovin, sizeBytes: 6 * 1024 * 1024 });
check('size limit is an error', oversized.some((issue) => issue.code === 'size' && issue.severity === 'error'));

const withUrl = { ...values, ctaText: 'see https://evil.example.com/x' };
const urlHtml = composeHtml(build, withUrl, {});
const urlIssues = validate({ ...base, html: urlHtml, values: withUrl, network: applovin });
check('new external url is an error', urlIssues.some((issue) => issue.code === 'external-url'));

const badEnum = { ...values, difficulty: 'nightmare' };
const enumIssues = validate({
    build,
    html: composeHtml(build, badEnum, {}),
    values: badEnum,
    sizeBytes: blob.size,
    network: applovin,
    assetIssues: [],
    runtimeRedirects: [],
    runtimeRequests: [],
});
check('value outside options is an error', enumIssues.some((issue) => issue.code === 'enum'));


console.log('export');
const zipSource = new JSZip();
zipSource.file('index.html', source.toString('utf-8'));
zipSource.file('config.json', JSON.stringify({ orientation: 'portrait', playable_languages: ['en'] }));
const zipBytes = await zipSource.generateAsync({ type: 'uint8array' });
const zipBuild = await loadBuild(new File([zipBytes], 'MyGame_v1_MINTEGRAL.zip'));

check('base name drops network and orientation tails', suggestBaseName('MyGame_v1_AL_portrait.html') === 'MyGame_v1', suggestBaseName('MyGame_v1_AL_portrait.html'));

const settings: ExportSettings = {
    baseName: 'MyGame_v1',
    networks: NETWORKS.map((network) => ({
        networkId: network.id,
        enabled: network.id === 'applovin' || network.id === 'mintegral',
        suffix: network.suffix,
        folder: network.folder,
        sourceId: network.id === 'mintegral' ? 'zip' : 'html',
    })),
    orientations: ORIENTATIONS.map((orientation) => ({
        orientation,
        enabled: orientation !== 'responsive',
        suffix: DEFAULT_ORIENTATION_SUFFIX[orientation],
    })),
};
const infos: ExportSourceInfo[] = [
    { id: 'html', networkId: 'applovin', format: 'html', bundle: false, recipeFormats: {} },
    { id: 'zip', networkId: 'mintegral', format: 'zip', bundle: false, recipeFormats: {} },
];
const plan = planExport(settings, NETWORKS, infos);
check('matrix is networks x orientations', plan.length === 4, plan.map((item) => item.path));
check(
    'paths carry folder, name and both suffixes',
    plan.map((item) => item.path).join(' ') ===
        'applovin/MyGame_v1_AL_portrait.html applovin/MyGame_v1_AL_landscape.html mintegral/MyGame_v1_MINTEGRAL_portrait.zip mintegral/MyGame_v1_MINTEGRAL_landscape.zip',
    plan.map((item) => item.path),
);
check('nothing is flagged as mismatched here', plan.every((item) => !item.mismatched));

const packed = await packExport(plan, [{ id: 'html', build }, { id: 'zip', build: zipBuild }], values, {});
const archive = await JSZip.loadAsync(await packed.blob.arrayBuffer());
check('archive holds every planned file', plan.every((item) => Boolean(archive.file(item.path))));

const htmlInside = await archive.file('applovin/MyGame_v1_AL_portrait.html')!.async('string');
const exported = await loadBuild(new File([htmlInside], 'exported.html'));
check('exported html carries the edited values', exported.values.ctaText === values.ctaText, exported.values.ctaText);

const landscapeZip = await JSZip.loadAsync(await archive.file('mintegral/MyGame_v1_MINTEGRAL_landscape.zip')!.async('uint8array'));
const landscapeConfig = JSON.parse(await landscapeZip.file('config.json')!.async('string'));
check('mintegral config.json follows the orientation', landscapeConfig.orientation === 'landscape', landscapeConfig);
check('other config fields survive', Array.isArray(landscapeConfig.playable_languages));

const noOrientation = planExport(
    { ...settings, orientations: settings.orientations.map((o) => ({ ...o, enabled: false })) },
    NETWORKS,
    infos,
);
check('without orientations each network yields one file', noOrientation.length === 2 && noOrientation[0].path === 'applovin/MyGame_v1_AL.html', noOrientation.map((i) => i.path));

console.log('rewrap (bundle → any network)');
const bundleFile = readFileSync(resolve(process.cwd(), 'public/fixtures/demo-tuner.html'));
const bundle = await loadBuild(new File([bundleFile], 'Demo_v1_TUNER.html', { type: 'text/html' }));

check('bundle is detected', bundle.manifest !== null);
check('manifest carries all eight recipes', bundle.manifest?.networks.length === 8, bundle.manifest?.networks.length);
check('bundle still exposes the tuning schema', bundle.schema?.params.length === 8, bundle.schema?.params.length);

const bundleInfo: ExportSourceInfo = {
    id: 'bundle',
    networkId: '',
    format: 'html',
    bundle: true,
    recipeFormats: Object.fromEntries((bundle.manifest?.networks ?? []).map((r) => [r.id, r.format])),
};
const applovinProfile = NETWORKS.find((n) => n.id === 'applovin')!;
const googleProfile = NETWORKS.find((n) => n.id === 'google')!;
check('a bundle can feed every network', NETWORKS.every((network) => canFeed(bundleInfo, network)));
check('output format comes from the recipe', targetFormat(bundleInfo, googleProfile) === 'zip');

const wrapped = await buildArtifact(bundle, 'applovin', null, values, {});
check('markers are gone from the artifact', !wrapped.html.includes('__PLAYABLE_MANIFEST_START__') && !wrapped.html.includes('__PLAYABLE_NEUTRAL_SDK_START__'));
check('recipe head html is injected', wrapped.html.includes('mraid.open(url)'));
check('sdk lands before the tuning block', wrapped.html.indexOf('mraid.open(url)') < wrapped.html.indexOf('__PLAYABLE_TUNING_START__'));
check('tuned values survive the rewrap', (await loadBuild(new File([wrapped.html], 'x.html'))).values.ctaText === values.ctaText);
check('recipe size limit is reported', wrapped.maxBytes === 5 * 1024 * 1024, wrapped.maxBytes);

const wrappedZip = await buildArtifact(bundle, 'mintegral', 'landscape', values, {});
const mintegralArchive = await JSZip.loadAsync(await wrappedZip.blob.arrayBuffer());
check('zip networks get index.html plus recipe entries', Boolean(mintegralArchive.file('index.html') && mintegralArchive.file('config.json')));
const wrappedConfig = JSON.parse(await mintegralArchive.file('config.json')!.async('string'));
check('recipe config.json follows the orientation', wrappedConfig.orientation === 'landscape', wrappedConfig);

const wrappedMeta = await buildArtifact(bundle, 'meta', null, values, {});
const metaChecks = validate({
    build: bundle,
    html: wrappedMeta.html,
    values,
    sizeBytes: wrappedMeta.blob.size,
    network: meta,
    artifactFormat: 'html',
    assetIssues: [],
    runtimeRedirects: [],
    runtimeRequests: [],
});
check('re-wrapped meta artifact passes its own symbol check', !metaChecks.some((issue) => issue.code === 'missing-symbol'), metaChecks);

const bundlePlan = planExport(
    {
        ...settings,
        networks: settings.networks.map((target) => ({ ...target, enabled: true, sourceId: 'bundle' })),
        orientations: settings.orientations.map((o) => ({ ...o, enabled: o.orientation === 'portrait' })),
    },
    NETWORKS,
    [bundleInfo],
);
check('one bundle plans all eight networks', bundlePlan.length === 8, bundlePlan.length);
check('zip networks get .zip paths', bundlePlan.find((item) => item.networkId === 'google')?.path.endsWith('.zip'));
check('nothing is mismatched when re-wrapping', bundlePlan.every((item) => !item.mismatched && item.rewrapped));
check('applovin still validates from the bundle', validate({
    build: bundle,
    html: (await buildArtifact(bundle, 'applovin', null, values, {})).html,
    values,
    sizeBytes: wrapped.blob.size,
    network: applovinProfile,
    artifactFormat: 'html',
    assetIssues: [],
    runtimeRedirects: [],
    runtimeRequests: [],
}).every((issue) => issue.severity !== 'error'));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
