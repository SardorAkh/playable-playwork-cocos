# Playable Tuner

Web host for finished playable builds: load a `.html`/`.zip`, tweak parameters and assets, run it
in a device frame (iPhone / iPad / Android / free-form), validate it against a network and download
a valid file back.

Implements the contract from the builder's `docs/tuner-integration.md`
(`E:\cocosprojects\playablebuilder`) — no Cocos, no game sources: everything needed is already
inside the build.

UI is English by default with a Russian switch (EN/RU in the top bar); the theme is Light by default,
with Dark and Auto next to it (Apple-style system palette). Both choices persist in localStorage.

Two kinds of input are accepted:

- **network artifacts** (`…_AL.html`, `…_GOOGLE.zip`) — tune, validate and re-download them as is;
- **a tuner bundle** (`tuner/…_TUNER.html`, contract §8) — network-neutral, carries a wrap recipe
  for every network, so all eight artifacts come out of this single file.

## Running

```bash
npm install
npm run dev
```

Open http://localhost:5183. Drop builds into the window (several at once is fine), pick them with
“Load build”, or link to one:
`?src=/fixtures/demo.html`.

```bash
npm run build          # static bundle in dist/ — deploy anywhere
npm test               # round-trip of parsing, patching and validation on the demo build
npm run fixture        # regenerate the demo build and the demo tuner bundle
npm run preview:pages  # serve dist/ from a subpath, the way GitHub Pages does
```

## Deploying to GitHub Pages

The build uses `base: './'`, so the same `dist/` works at a domain root and under
`https://<user>.github.io/<repo>/` without hardcoding the repository name — `preview.html` and the
assets resolve relative to the page. Everything runs in the browser; there is no backend, no API key
and nothing uploaded anywhere, so a static host is all this needs.

`.github/workflows/deploy.yml` builds and publishes on every push to `main` (it runs `npm test`
first). To switch it on:

```bash
git init -b main
git add -A
git commit -m "Playable Tuner"
git remote add origin git@github.com:<user>/<repo>.git
git push -u origin main
```

Then in the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The
first run publishes to `https://<user>.github.io/<repo>/`.

Deploying by hand works too — `npm run build` and serve `dist/` as-is. `.nojekyll` ships inside it
so a branch-based deploy does not run the files through Jekyll.

Before publishing, check that `public/fixtures/` is what you want public: the demo build and the demo
tuner bundle ship with the site (handy for trying it out — `?src=./fixtures/demo-tuner.html`) and
contain nothing but the generated demo game.

## Preview

- **Device** — iPhone (SE … 16 Pro Max), iPad (mini … Pro 12.9"), Android (Pixel 7, Galaxy S22,
  Tab S8). Frame with notch/island and home bar; the iframe inside gets exactly the CSS pixels of
  the real screen and is fitted into the pane with `transform: scale`.
- **Responsive** — any size: numeric fields, presets, and dragging the right/bottom edge or corner.
- **Cutout** — the notch and home indicator are translucent, so the playable stays readable under
  them, and the status bar has a switch to drop them entirely.
- **Rotate** (button or `O`) flips orientation **without reloading** — the game gets a plain
  `resize`, like on a real device.
- **Restart** (button or `R`) recomposes the HTML with the current parameter values and boots the
  playable again; the site itself never reloads. Parameters without `live: true` mark the preview
  stale and turn the button amber. Auto-restart is available.
- **Log** — `window.playable` lifecycle calls, CTA clicks with the target URL, redirects, outbound
  requests, errors and `console.warn/error`. Values are cut to 2000 chars **inside the preview**
  (before postMessage), collapsed to two lines in the UI, and expandable by click; the badge shows
  the original size.

### Why the preview loads through `preview.html`

Every build carries a VFS runtime that derives its base directory from `location.href` and
**ignores any URL starting with `blob:`** — so a blob-URL preview finds neither `index.js` nor the
assets, while `srcdoc` resolves relative paths against `about:srcdoc` and breaks SystemJS. Instead
the iframe loads `public/preview.html` from the same origin; the tuner posts the composed HTML to
it and the page writes it over itself with `document.write`. The document keeps a normal URL, so
asset resolution matches opening the build as a file.

On top of that the preview (and only the preview) gets a shim: stubs for `mraid`, `dapi`,
`FbPlayableAd`, `ExitApi`, `openAppStore`, interception of `window.open`, fetch/XHR/beacon/image
requests, page unload, and the live-patch bridge. The shim never reaches the exported file.

`strict sandbox` in the status bar drops `allow-same-origin` (isolation as in `docs §5`), at the
cost of `localStorage` throwing inside the playable — off by default.

## Export

Load a tuner bundle and every network is available from it; load network artifacts and each one
feeds its own folder. Several files can be loaded at once (multi-select, or drop them together);
each is shown as a chip under the top bar and clicking a chip previews it. Parameters and swapped
assets are shared across everything loaded: one game, one set of values.

### Re-wrapping a bundle (contract §8)

A bundle is recognised by its `__PLAYABLE_MANIFEST__` block and marked `bundle · any network`.
Ticking a network builds that network's artifact right here, following §8.3 exactly: strip the
neutral-SDK and manifest blocks, insert `recipe.headHtml` after `<head>` (so it lands before the
tuning block), append `recipe.bodyEndHtml`, and for `format: "zip"` pack `index.html` together with
the recipe's `zipEntries` (DEFLATE 9). Output format, file-size limit and extra files all come from
the recipe, so a bundle can produce `.zip` for Mintegral/Google/TikTok and `.html` for the rest.
Validation runs against the **re-wrapped** artifact, not the bundle — that is what actually ships.

Tuning and re-wrapping are independent: values and assets are applied first, the wrap on top.

The Export tab is a matrix of **networks × orientations**:

- **Playable name** — the common file-name stem, pre-filled from the first build with network and
  orientation tails stripped.
- **Networks** — a checkbox per network, each with an editable **folder**, an editable **suffix**
  (`_AL`, `_FB`, `_MINTEGRAL` …) and a **source** picker saying which loaded file feeds it. A bundle
  can feed any of them; a network artifact only fits its own format, and pointing one at a different
  network is allowed but flagged as "its SDK will not match this folder".
- **Orientations** — Portrait / Landscape / Responsive checkboxes, each with an editable suffix.
  Tick none and every network yields a single file without an orientation suffix.
- **Output** — the exact list of paths that will be produced.

The result is one zip laid out as `<network folder>/<name><network suffix><orientation suffix>.<ext>`;
a plan of exactly one file downloads that file directly instead. Orientation goes into the file name,
and for Mintegral into `config.json` — everywhere else the builder has already baked it into the
document and the campaign settings decide the rest.

## Parameters and assets

The parameter panel is generated from `window.__TUNING_SCHEMA__`: `number` (slider + input),
`boolean`, `string`, `select`, `color`, and `image`/`audio` on the Assets tab. Values are written
back as a single `window.__TUNING__ = …;` line with `</script` → `<\/script` escaping; the schema
is never edited.

### Categories (tuning-groups.md)

`schema.groups` splits both panels into sections — parameters and their assets land in the same
category, since they are one list in the schema. Rules the tuner follows:

- **Order is never touched.** Sections follow `groups`, fields follow `params`; `general` stays last.
- `label` titles the section, `description` sits under it, `collapsed: true` starts it folded.
- **Empty sections are shown**, not hidden — a category nobody points at usually means a typo in
  some param's `group`, and that is worth seeing. A category holding only image/audio is a different
  case and says so, pointing at the Assets tab.
- **Search** matches a param's label and key, plus its category's title and description — so
  "hero" finds both the hero's fields and the hero category.
- A schema **without** `groups` (older builds) renders exactly as before: one implicit `general`
  section with no section chrome. A `group` pointing at an undeclared category gets that category
  synthesised rather than dropping the field.

Categories are presentational: `window.__TUNING__` stays a flat object keyed by param, and moving a
param between categories never touches an already-built playable.

Every asset row states what it actually is, read from the file header rather than by decoding it:
resolution and format for images, duration, sample rate, channel count and bitrate for audio, next
to the byte size. Formats no header probe here covers (AVIF, m4a duration) fall back to the
browser decoder. **Download** saves the asset exactly as it currently sits inside the playable —
named after the parameter label — so an artist can pull the original, rework it and swap it back.

Asset replacement goes through `__TUNING_ASSETS__` → `__PLAYABLE_FS__`: only `d` is swapped, `t` and
`e` are preserved. An image/audio param the schema declares but `__TUNING_ASSETS__` does not carry
never made it into the build (atlas, compressed texture): the field is shown, replacement blocked. If
the build declares no image/audio parameters at all, every VFS media file is listed with a filter.

**Size and format of a replacement do not matter** (contract §4). An image slot carries `fit` — the
footprint the original occupied in the scene — and the runtime redraws whatever is dropped in into
that area, so any picture of any size and format is accepted; the row shows the slot and says when the
aspect ratio differs, which only means transparent margins, not breakage. A slot **without** `fit` is
the exception: there the bytes reach the engine as they are, the size has to match the original, and
the row says so (a mismatch is what produces `Error 3300`). Audio is the same — the runtime detects
the format by signature. The one thing refused outright is crossing the two: a sound cannot replace a
picture, or the other way round.

VFS entries come in two encodings: base64 for binaries, and the file's own text when the entry says
`e: "utf8"` (base64 would add a third to the weight of a couple of megabytes of engine JS). Sizes,
probes, scans and downloads all go through `core/vfs.ts`, so neither case is decoded the wrong way.
Payloads escape both `</script` (keeping the tag's case) and `<!--` as `<!--`.

Value presets are stored in localStorage and can be exported/imported as JSON.

## Validation

“Validate” checks every network that is actually going to be exported, against the build feeding it,
and reports size and issues per network.

**Download never refuses.** The file is always produced — validation informs, it does not gate. When
a check has already found errors the button turns amber and says how many, and after the download a
banner repeats it. Whether a creative goes to a network is your call, not the tool's.

Findings shared by every network — they come from the game itself, not from one network — are stated
once in a **Common to every network** block, so eight copies of the same redirect warning do not read
as a wall of problems. Each network then lists only what is specific to it: size, a missing SDK
symbol, a format mismatch.

Errors:

- over the network size limit (5 MB for all eight; under 10% headroom is a warning);
- damaged tuning-block markers;
- a value that does not match its schema type, or a `select` outside `options`;
- a new external URL introduced in the parameters;
- the network's CTA symbol missing (`mraid.open`, `FbPlayableAd`, `ExitApi.exit`);
- no CTA call at all;
- `<meta http-equiv="refresh">`;
- a direct redirect (`location.href =`, `location.replace()`, `location.assign()`, `top.location`)
  when the build has **no** working SDK call — then the CTA bypasses the network entirely;
- an outbound request the playable actually made during preview.

Warnings: the same redirect patterns when they sit next to a working `mraid.open` (the usual
fallback), `window.open()`, a missing `<script src="mraid.js">` for MRAID networks, external hosts
mentioned in the build (store and engine-boilerplate hosts are filtered out), the playable leaving
the page during preview, asset format mismatch, `number` outside `min/max`, a color that is not
`#rrggbb`, and a file format that does not match the selected network.

The redirect/symbol scan covers the document **and the text files inside the VFS** — the game
bundle lives there as base64, so a scan that skipped it would see nothing. Network signatures live
in `src/core/networks.ts` as data with a `signaturesCheckedAt` date, shown under the issue list.

## Layout

```
src/core/        build parsing and patching — no React
  text.ts        markers, assignment read/write, VFS, URL scan
  bundle.ts      .html/.zip loading, final file assembly (jszip)
  validate.ts    rules from docs §5 plus the redirect/SDK checks
  networks.ts    network profiles, limits, signatures, redirect patterns
  previewShim.ts preview shim, postMessage channels, log clipping
  schema.ts      tuning categories: sections, ordering, search, swappable assets
  media.ts       header-only probes: image resolution, audio rate/channels/bitrate/duration
  vfs.ts         VFS entries: base64 vs utf8 payloads, sizes, head slices, swaps
  rewrap.ts      manifest reading and the §8.3 bundle → network artifact procedure
  export.ts      network × orientation matrix, file naming, archive packing
src/i18n.tsx     dictionaries and the translate hook
src/theme.ts     Auto / Light / Dark
src/ui/          DevicePreview (frame, orientation, zoom, resize) and the panels
public/preview.html  preview host page
tools/           demo-build generator and the round-trip test
```

## Not included

A **network artifact** still cannot be turned into another network: its SDK is already baked in and
it carries no manifest, so a loaded `.zip` stays a `.zip` and an `.html` stays an `.html`. Export the
tuner bundle from the builder instead — that is exactly what §8 exists for. Pointing an artifact at a
foreign folder anyway is allowed, but the plan marks it and the format mismatch is a warning.

Foreign builds (from other tools, without the tuning block or the manifest) are not converted either:
they can be previewed and scanned, nothing more.

Live patches for `live: true` parameters are posted into the preview (`channel: playable-tuning`,
`type: patch`) and applied to `window.__TUNING__` with a `playable:tuning` event. Until the game
listens for that event, only a restart shows the change — which is why the restart button is always
available.
