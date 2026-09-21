export interface NetworkProfile {
    id: string;
    label: string;
    format: 'html' | 'zip';
    maxBytes: number;
    /** The call a playable must use to open the store in this network's container. */
    ctaSymbol: string;
    /** Alternatives: at least one of these must be present for the CTA to work. */
    requiredSymbols: string[];
    /** Containers that inject MRAID expect the build to ask for it with a script tag. */
    needsMraidTag: boolean;
    allowsExternalRequests: boolean;
    /** URLs that are legitimately present in builds for this network. */
    allowedUrls: RegExp[];
    /** Default file-name suffix and output folder — both editable in the export panel. */
    suffix: string;
    folder: string;
    /** Signature table is data, not code — this is when it was last checked against the docs. */
    signaturesCheckedAt: string;
}

const MB = 1024 * 1024;
const CHECKED = '2026-09-13';

export const NETWORKS: NetworkProfile[] = [
    {
        id: 'applovin',
        label: 'AppLovin',
        format: 'html',
        maxBytes: 5 * MB,
        ctaSymbol: 'mraid.open',
        requiredSymbols: ['mraid.open'],
        needsMraidTag: true,
        allowsExternalRequests: false,
        allowedUrls: [],
        suffix: '_AL',
        folder: 'applovin',
        signaturesCheckedAt: CHECKED,
    },
    {
        id: 'unity',
        label: 'Unity Ads',
        format: 'html',
        maxBytes: 5 * MB,
        ctaSymbol: 'mraid.open',
        requiredSymbols: ['mraid.open'],
        needsMraidTag: true,
        allowsExternalRequests: false,
        allowedUrls: [],
        suffix: '_UNITY',
        folder: 'unity',
        signaturesCheckedAt: CHECKED,
    },
    {
        id: 'ironsource',
        label: 'IronSource',
        format: 'html',
        maxBytes: 5 * MB,
        ctaSymbol: 'dapi.openStoreUrl / mraid.open',
        requiredSymbols: ['dapi.openStoreUrl', 'mraid.open'],
        needsMraidTag: true,
        allowsExternalRequests: false,
        allowedUrls: [],
        suffix: '_IS',
        folder: 'ironsource',
        signaturesCheckedAt: CHECKED,
    },
    {
        id: 'meta',
        label: 'Meta',
        format: 'html',
        maxBytes: 5 * MB,
        ctaSymbol: 'FbPlayableAd.onCTAClick',
        requiredSymbols: ['FbPlayableAd'],
        needsMraidTag: false,
        allowsExternalRequests: false,
        allowedUrls: [],
        suffix: '_FB',
        folder: 'meta',
        signaturesCheckedAt: CHECKED,
    },
    {
        id: 'liftoff',
        label: 'Liftoff / Vungle',
        format: 'html',
        maxBytes: 5 * MB,
        ctaSymbol: 'mraid.open',
        requiredSymbols: ['mraid.open'],
        needsMraidTag: true,
        allowsExternalRequests: false,
        allowedUrls: [],
        suffix: '_LIFTOFF',
        folder: 'liftoff',
        signaturesCheckedAt: CHECKED,
    },
    {
        id: 'mintegral',
        label: 'Mintegral',
        format: 'zip',
        maxBytes: 5 * MB,
        ctaSymbol: 'mraid.open',
        requiredSymbols: ['mraid.open'],
        needsMraidTag: true,
        allowsExternalRequests: false,
        allowedUrls: [],
        suffix: '_MINTEGRAL',
        folder: 'mintegral',
        signaturesCheckedAt: CHECKED,
    },
    {
        id: 'google',
        label: 'Google',
        format: 'zip',
        maxBytes: 5 * MB,
        ctaSymbol: 'ExitApi.exit',
        requiredSymbols: ['ExitApi.exit'],
        needsMraidTag: false,
        allowsExternalRequests: false,
        allowedUrls: [/tpc\.googlesyndication\.com/i],
        suffix: '_GOOGLE',
        folder: 'google',
        signaturesCheckedAt: CHECKED,
    },
    {
        id: 'tiktok',
        label: 'TikTok / Pangle',
        format: 'zip',
        maxBytes: 5 * MB,
        ctaSymbol: 'mraid.open',
        requiredSymbols: ['mraid.open'],
        needsMraidTag: true,
        allowsExternalRequests: false,
        allowedUrls: [],
        suffix: '_TIKTOK',
        folder: 'tiktok',
        signaturesCheckedAt: CHECKED,
    },
];

/** Patterns that leave the ad container on their own instead of going through the network SDK. */
export const REDIRECT_PATTERNS: { label: string; pattern: RegExp }[] = [
    { label: 'location.href =', pattern: /\blocation\s*\.\s*href\s*=(?!=)/ },
    { label: 'location.replace()', pattern: /location\s*\.\s*replace\s*\(/ },
    { label: 'location.assign()', pattern: /location\s*\.\s*assign\s*\(/ },
    { label: 'top.location', pattern: /\btop\s*\.\s*location\b/ },
    { label: 'document.location =', pattern: /\bdocument\s*\.\s*location\s*=(?!=)/ },
];

/** Store links are the CTA target, not an outbound request — never report them as one. */
export const STORE_HOSTS = [
    'play.google.com',
    'apps.apple.com',
    'itunes.apple.com',
    'galaxystore.samsung.com',
    'appgallery.huawei.com',
    'amazon.com',
];

/** Namespaces, doc links and error-message URLs that engines carry around without requesting them. */
export const NOISE_HOSTS = [
    'www.w3.org',
    'w3.org',
    'git.io',
    'www.html5rocks.com',
    'developer.apple.com',
    'schema.org',
    'www.cocos.com',
    'docs.cocos.com',
    'cocos.com',
    'github.com',
    'www.gnu.org',
    'opensource.org',
    'creativecommons.org',
    'purl.org',
    'ns.adobe.com',
];

export function hostOf(url: string): string {
    const match = /^https?:\/\/([^/?#:]+)/i.exec(url);
    return match ? match[1].toLowerCase() : '';
}

export const META_REFRESH = /<meta[^>]+http-equiv\s*=\s*["']?\s*refresh/i;
export const WINDOW_OPEN = /window\s*\.\s*open\s*\(/;
export const MRAID_TAG = /<script[^>]+src\s*=\s*["']?[^"'>]*mraid\.js/i;
export const CTA_CALLS = /playable\s*\.\s*cta\s*\(|openStore\s*\(|openAppStore\s*\(|install\s*\(/;

/** Filename hints the builder leaves behind, so the target network is preselected on upload. */
const FILE_HINTS: { pattern: RegExp; id: string }[] = [
    { pattern: /_AL\b|applovin/i, id: 'applovin' },
    { pattern: /_UNITY\b|unityads/i, id: 'unity' },
    { pattern: /_IS\b|ironsource/i, id: 'ironsource' },
    { pattern: /_FB\b|meta|facebook/i, id: 'meta' },
    { pattern: /liftoff|vungle/i, id: 'liftoff' },
    { pattern: /mintegral/i, id: 'mintegral' },
    { pattern: /google/i, id: 'google' },
    { pattern: /tiktok|pangle/i, id: 'tiktok' },
];

export function guessNetwork(fileName: string, kind: 'html' | 'zip'): NetworkProfile {
    const hit = FILE_HINTS.find((hint) => hint.pattern.test(fileName));
    const guessed = hit && NETWORKS.find((network) => network.id === hit.id);
    if (guessed && guessed.format === kind) return guessed;
    return NETWORKS.find((network) => network.format === kind)!;
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / MB).toFixed(2)} MB`;
}
