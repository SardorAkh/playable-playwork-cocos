import { entryText, isTextEntry } from './vfs';
import {
    CTA_CALLS,
    META_REFRESH,
    MRAID_TAG,
    NOISE_HOSTS,
    REDIRECT_PATTERNS,
    STORE_HOSTS,
    WINDOW_OPEN,
    hostOf,
} from './networks';
import type { NetworkProfile } from './networks';
import { formatBytes } from './networks';
import { isAssetParam } from './schema';
import { collectUrls, hasIntactMarkers, tuningBlock } from './text';
import type { LoadedBuild, TuningParam, TuningValues, ValidationIssue } from './types';

const HEADROOM = 0.9;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SCANNABLE_MIME = /^(text\/|application\/(javascript|json|xml|ecmascript))/i;
const SCAN_BUDGET = 12 * 1024 * 1024;
const URL_REPORT_LIMIT = 8;

function typeIssue(param: TuningParam, value: unknown): ValidationIssue | null {
    const label = param.label ?? param.key;
    switch (param.type) {
        case 'number':
            if (typeof value !== 'number' || Number.isNaN(value)) {
                return { severity: 'error', code: 'type-number', params: { label } };
            }
            if ((param.min !== undefined && value < param.min) || (param.max !== undefined && value > param.max)) {
                return {
                    severity: 'warning',
                    code: 'range',
                    params: { label, value, min: param.min ?? '−∞', max: param.max ?? '∞' },
                };
            }
            return null;
        case 'boolean':
            return typeof value === 'boolean' ? null : { severity: 'error', code: 'type-boolean', params: { label } };
        case 'string':
            return typeof value === 'string' ? null : { severity: 'error', code: 'type-string', params: { label } };
        case 'select':
            if (typeof value !== 'string' || !(param.options ?? []).includes(value)) {
                return { severity: 'error', code: 'enum', params: { label } };
            }
            return null;
        case 'color':
            if (typeof value !== 'string') return { severity: 'error', code: 'type-color', params: { label } };
            return HEX_COLOR.test(value) ? null : { severity: 'warning', code: 'color', params: { label } };
        default:
            return null;
    }
}

/**
 * Text files hiding in the VFS as base64 — the game bundle lives there, so a redirect scan that
 * skips it sees nothing. Decoding is cached per build: validating eight networks re-reads the same
 * megabytes otherwise.
 */
const vfsTextCache = new WeakMap<LoadedBuild, string[]>();

function vfsTexts(build: LoadedBuild): string[] {
    const cached = vfsTextCache.get(build);
    if (cached) return cached;

    const texts: string[] = [];
    let budget = SCAN_BUDGET;
    for (const [path, entry] of Object.entries(build.vfs ?? {})) {
        if (budget <= 0) break;
        const looksTextual =
            isTextEntry(entry) || SCANNABLE_MIME.test(entry.t) || /\.(js|json|txt|xml|css|html)$/i.test(path);
        if (!looksTextual) continue;
        try {
            const text = entryText(entry);
            budget -= text.length;
            texts.push(text);
        } catch {
            // A mislabelled binary — nothing to scan.
        }
    }
    vfsTextCache.set(build, texts);
    return texts;
}

function scannableSources(build: LoadedBuild, html: string): string[] {
    return [html, ...vfsTexts(build)];
}

function findIn(sources: string[], pattern: RegExp): boolean {
    return sources.some((source) => pattern.test(source));
}

/**
 * Hosts the build mentions that are neither the store, engine boilerplate (namespaces, doc links)
 * nor explicitly allowed for the network. Static text cannot tell a link from a request, so this
 * is a prompt to look — the shim's runtime report is the one that proves an actual request.
 */
function suspiciousHosts(sources: string[], network: NetworkProfile): string[] {
    const found = new Set<string>();
    for (const source of sources) {
        for (const url of collectUrls(source)) {
            if (network.allowedUrls.some((allowed) => allowed.test(url))) continue;
            const host = hostOf(url);
            if (!host || STORE_HOSTS.includes(host) || NOISE_HOSTS.includes(host)) continue;
            found.add(host);
        }
    }
    return [...found];
}

export interface ValidateInput {
    build: LoadedBuild;
    html: string;
    values: TuningValues;
    sizeBytes: number;
    network: NetworkProfile;
    /** Format of the artifact actually produced — a bundle can output a format its own file is not. */
    artifactFormat?: 'html' | 'zip';
    /** Issues raised at asset-swap time (format mismatch and the like). */
    assetIssues: ValidationIssue[];
    /** Redirect attempts the preview shim intercepted while the build was running. */
    runtimeRedirects: string[];
    /** Outbound requests that actually left the playable during preview. */
    runtimeRequests: string[];
}

export function validate(input: ValidateInput): ValidationIssue[] {
    const { build, html, values, sizeBytes, network } = input;
    const issues: ValidationIssue[] = [];
    const limit = formatBytes(network.maxBytes);

    if (sizeBytes > network.maxBytes) {
        issues.push({
            severity: 'error',
            code: 'size',
            params: { size: formatBytes(sizeBytes), network: network.label, limit },
        });
    } else if (sizeBytes > network.maxBytes * HEADROOM) {
        issues.push({ severity: 'warning', code: 'size-headroom', params: { size: formatBytes(sizeBytes), limit } });
    }

    const artifactFormat = input.artifactFormat ?? build.kind;
    if (artifactFormat !== network.format) {
        issues.push({
            severity: 'warning',
            code: 'format',
            params: { network: network.label, expected: network.format, actual: artifactFormat },
        });
    }

    if (build.hasTuningBlock && !hasIntactMarkers(html)) {
        issues.push({ severity: 'error', code: 'markers' });
    }

    for (const param of build.schema?.params ?? []) {
        if (isAssetParam(param)) continue;
        const issue = typeIssue(param, values[param.key]);
        if (issue) issues.push(issue);
    }

    const sources = scannableSources(build, html);
    // The symbols are alternatives — IronSource, for one, goes through dapi with an mraid fallback.
    const hasCtaSymbol = network.requiredSymbols.some((symbol) => findIn(sources, new RegExp(escapeRegExp(symbol))));
    if (!hasCtaSymbol) {
        issues.push({
            severity: 'error',
            code: 'missing-symbol',
            params: { network: network.label, symbol: network.requiredSymbols.join(' / ') },
        });
    }

    if (network.needsMraidTag && !MRAID_TAG.test(html)) {
        issues.push({ severity: 'warning', code: 'missing-mraid', params: { network: network.label } });
    }

    if (!findIn(sources, CTA_CALLS) && !hasCtaSymbol) {
        issues.push({ severity: 'error', code: 'no-cta', params: { symbol: network.ctaSymbol } });
    }

    if (META_REFRESH.test(html)) {
        issues.push({ severity: 'error', code: 'meta-refresh' });
    }

    for (const redirect of REDIRECT_PATTERNS) {
        if (!findIn(sources, redirect.pattern)) continue;
        issues.push({
            // A bare redirect next to a working SDK call is the usual fallback; alone it means
            // the CTA bypasses the network entirely, which gets the creative rejected.
            severity: hasCtaSymbol ? 'warning' : 'error',
            code: 'redirect',
            params: { pattern: redirect.label, network: network.label, symbol: network.ctaSymbol },
        });
    }

    if (WINDOW_OPEN.test(html)) {
        issues.push({ severity: 'warning', code: 'window-open', params: { symbol: network.ctaSymbol } });
    }

    // The tuning block is the only region a tuner edit can touch, and base64 cannot contain
    // "http://" — so a URL that is new *there* was introduced here and is an error.
    const before = tuningBlock(build.html);
    const after = tuningBlock(html);
    const introduced = new Set<string>();
    if (before !== null && after !== null) {
        const known = collectUrls(before);
        for (const url of collectUrls(after)) {
            if (known.has(url) || network.allowedUrls.some((allowed) => allowed.test(url))) continue;
            introduced.add(url);
            issues.push({ severity: 'error', code: 'external-url', params: { url } });
        }
    }

    if (!network.allowsExternalRequests) {
        const hosts = suspiciousHosts(sources, network).filter((host) => ![...introduced].some((url) => url.includes(host)));
        if (hosts.length > 0) {
            issues.push({
                severity: 'warning',
                code: 'external-hosts',
                params: {
                    hosts: hosts.slice(0, URL_REPORT_LIMIT).join(', '),
                    more: Math.max(0, hosts.length - URL_REPORT_LIMIT),
                },
            });
        }
    }

    for (const via of new Set(input.runtimeRedirects)) {
        issues.push({ severity: 'warning', code: 'runtime-redirect', params: { via, symbol: network.ctaSymbol } });
    }

    for (const url of new Set(input.runtimeRequests)) {
        issues.push({ severity: 'error', code: 'runtime-request', params: { url } });
    }

    issues.push(...input.assetIssues);
    return issues;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function blocking(issues: ValidationIssue[]): boolean {
    return issues.some((issue) => issue.severity === 'error');
}
