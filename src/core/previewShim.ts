export const PREVIEW_CHANNEL = 'playable-tuner';
export const TUNING_CHANNEL = 'playable-tuning';
/** Handshake with public/preview.html, which writes the composed build over itself. */
export const PREVIEW_HOST_CHANNEL = 'playable-preview-host';
export const PREVIEW_HOST_URL = `${import.meta.env.BASE_URL}preview.html`;

/** Anything longer is cut inside the preview — a single console.log can otherwise be megabytes. */
export const SHIM_TEXT_LIMIT = 2000;

const SHIM_SOURCE = `
(function () {
    var CHANNEL = '${PREVIEW_CHANNEL}';
    var TUNING_CHANNEL = '${TUNING_CHANNEL}';
    var LIMIT = ${SHIM_TEXT_LIMIT};

    function send(type, payload) {
        try { parent.postMessage({ channel: CHANNEL, type: type, payload: payload }, '*'); } catch (ignored) {}
    }

    // Values reaching the log can be a whole scene graph; cut here, before postMessage.
    function clip(value) {
        var text;
        if (typeof value === 'string') {
            text = value;
        } else {
            try { text = JSON.stringify(value); } catch (ignored) { text = String(value); }
            if (text === undefined) text = String(value);
        }
        if (text.length <= LIMIT) return { text: text };
        return { text: text.slice(0, LIMIT), full: text.length };
    }

    // Keep the original size even when a piece was already cut — otherwise re-clipping the
    // joined string looks short enough and the "truncated" mark is lost.
    function clipAll(list) {
        var parts = [];
        var full = 0;
        var cut = false;
        for (var i = 0; i < list.length && i < 8; i++) {
            var piece = clip(list[i]);
            parts.push(piece.text);
            full += piece.full || piece.text.length;
            if (piece.full) cut = true;
        }
        var joined = clip(parts.join(', '));
        if (joined.full) {
            cut = true;
            full = Math.max(full, joined.full);
        }
        return cut ? { text: joined.text, full: full } : { text: joined.text };
    }

    var origin = location.protocol + '//' + location.host;
    function isExternal(url) {
        if (typeof url !== 'string') return false;
        if (!/^https?:\\/\\//i.test(url)) return false;
        return url.indexOf(origin + '/') !== 0 && url !== origin;
    }

    var noop = function () {};
    if (typeof window.mraid === 'undefined') {
        window.mraid = {
            getState: function () { return 'ready'; },
            getVersion: function () { return '3.0'; },
            getPlacementType: function () { return 'interstitial'; },
            isViewable: function () { return true; },
            supports: function () { return false; },
            addEventListener: function (name, fn) {
                if (name === 'ready') setTimeout(fn, 0);
                if (name === 'viewableChange') setTimeout(function () { fn(true); }, 0);
            },
            removeEventListener: noop,
            setOrientationProperties: noop,
            useCustomClose: noop,
            expand: noop,
            close: function () { send('lifecycle', { name: 'mraid.close', args: '' }); },
            open: function (url) { send('cta', { via: 'mraid.open', url: clip(url).text }); }
        };
        window.mraidReady = true;
    }
    if (typeof window.dapi === 'undefined') {
        window.dapi = {
            isReady: function () { return true; },
            addEventListener: function (name, fn) { if (name === 'ready') setTimeout(fn, 0); },
            removeEventListener: noop,
            openStoreUrl: function (url) { send('cta', { via: 'dapi.openStoreUrl', url: clip(url).text }); },
            reportAdClick: noop
        };
    }
    if (typeof window.FbPlayableAd === 'undefined') {
        window.FbPlayableAd = { onCTAClick: function () { send('cta', { via: 'FbPlayableAd.onCTAClick' }); } };
    }
    if (typeof window.ExitApi === 'undefined') {
        window.ExitApi = { exit: function () { send('cta', { via: 'ExitApi.exit' }); } };
    }
    if (typeof window.openAppStore === 'undefined') {
        window.openAppStore = function () { send('cta', { via: 'openAppStore' }); };
    }
    if (typeof window.install === 'undefined') {
        window.install = function () { send('cta', { via: 'install' }); };
    }
    window.open = function (url) { send('cta', { via: 'window.open', url: clip(url).text }); return null; };
    window.__playableRedirect = function (url) { send('cta', { via: 'redirect', url: clip(url).text }); };

    // Redirects that bypass the SDK. assign/replace can be shadowed; a bare
    // "location.href = x" cannot, so the unload below is what catches that one.
    ['assign', 'replace'].forEach(function (name) {
        try {
            var original = location[name].bind(location);
            Object.defineProperty(location, name, {
                configurable: true,
                value: function (url) {
                    send('redirect', { via: 'location.' + name, url: clip(url).text });
                    if (!isExternal(url)) original(url);
                }
            });
        } catch (ignored) {}
    });
    window.addEventListener('beforeunload', function () { send('redirect', { via: 'unload', url: '' }); });

    // The VFS runtime inside the build wraps fetch/XHR after this shim, so whatever reaches
    // these wrappers is what the VFS could not serve — i.e. a request that really leaves.
    var fetchOriginal = window.fetch;
    if (typeof fetchOriginal === 'function') {
        window.fetch = function (input, init) {
            var url = typeof input === 'string' ? input : (input && input.url) || '';
            if (isExternal(url)) send('request', { method: (init && init.method) || 'GET', url: clip(url).text });
            return fetchOriginal.apply(this, arguments);
        };
    }
    var xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        if (isExternal(url)) send('request', { method: method || 'GET', url: clip(url).text });
        return xhrOpen.apply(this, arguments);
    };
    if (navigator.sendBeacon) {
        var beacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function (url, data) {
            if (isExternal(url)) send('request', { method: 'BEACON', url: clip(url).text });
            return beacon(url, data);
        };
    }
    try {
        var imageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
            configurable: true,
            get: function () { return imageSrc.get.call(this); },
            set: function (value) {
                if (isExternal(value)) send('request', { method: 'IMG', url: clip(value).text });
                return imageSrc.set.call(this, value);
            }
        });
    } catch (ignored) {}

    // The game assigns window.playable later; intercept the assignment to mirror its events.
    var facade;
    function mirror(target) {
        if (!target || typeof target !== 'object') return target;
        var wrapped = {};
        Object.keys(target).forEach(function (name) {
            var original = target[name];
            wrapped[name] = typeof original !== 'function' ? original : function () {
                var args = clipAll(Array.prototype.slice.call(arguments));
                send('lifecycle', { name: name, args: args.text, full: args.full });
                return original.apply(target, arguments);
            };
        });
        return wrapped;
    }
    try {
        Object.defineProperty(window, 'playable', {
            configurable: true,
            get: function () { return facade; },
            set: function (value) { facade = mirror(value); }
        });
    } catch (ignored) {}

    window.addEventListener('error', function (event) {
        var message = clip(event.message || (event.error && event.error.stack) || event.error);
        send('error', { text: message.text, full: message.full, source: event.filename, line: event.lineno });
    });
    window.addEventListener('unhandledrejection', function (event) {
        var reason = event.reason;
        var message = clip('unhandledrejection: ' + ((reason && (reason.stack || reason.message)) || reason));
        send('error', { text: message.text, full: message.full });
    });
    ['warn', 'error'].forEach(function (level) {
        var original = console[level];
        console[level] = function () {
            var joined = clipAll(Array.prototype.slice.call(arguments));
            send('console', { level: level, text: joined.text, full: joined.full });
            return original.apply(console, arguments);
        };
    });

    // Tuner side of the live-patch bridge (tuner-integration.md §6).
    window.addEventListener('message', function (event) {
        var data = event.data;
        if (!data || data.channel !== TUNING_CHANNEL || data.type !== 'patch') return;
        var values = data.values || {};
        window.__TUNING__ = window.__TUNING__ || {};
        Object.keys(values).forEach(function (key) { window.__TUNING__[key] = values[key]; });
        try { window.dispatchEvent(new CustomEvent('playable:tuning', { detail: values })); } catch (ignored) {}
        send('patched', { keys: Object.keys(values).join(', ') });
    });

    // A build may offer to check a value before it is used -- a level
    // description, a config blob, anything whose rules only the game knows.
    // It is optional: a build that defines nothing simply answers "no".
    window.addEventListener('message', function (event) {
        var data = event.data;
        if (!data || data.channel !== TUNING_CHANNEL || data.type !== 'check') return;

        var reply = { id: data.id, key: data.key, supported: false, ok: false, errors: [], warnings: [], notes: [] };
        try {
            var check = window.__tuningCheck__;
            if (typeof check === 'function') {
                reply.supported = true;
                var out = check(data.key, data.value) || {};
                reply.ok = out.ok === true;
                reply.errors = out.errors || [];
                reply.warnings = out.warnings || [];
                reply.notes = out.notes || [];
            }
        } catch (error) {
            reply.supported = true;
            reply.ok = false;
            reply.errors = [String((error && error.message) || error)];
        }
        send('checked-value', reply);
    });

    window.addEventListener('load', function () { send('loaded', { at: Date.now() }); });
    send('ready', { at: Date.now() });
})();
`;

/**
 * Preview-only bootstrap: stubs the network SDKs so a build runs outside its container,
 * and reports lifecycle/CTA/redirects/requests/errors back to the tuner. Never exported.
 */
export const PREVIEW_SHIM = `<script>/*__TUNER_PREVIEW_SHIM__*/${SHIM_SOURCE}</script>`;

export function withPreviewShim(html: string): string {
    const headMatch = html.match(/<head[^>]*>/i);
    if (!headMatch || headMatch.index === undefined) return PREVIEW_SHIM + html;
    const at = headMatch.index + headMatch[0].length;
    return html.slice(0, at) + PREVIEW_SHIM + html.slice(at);
}
