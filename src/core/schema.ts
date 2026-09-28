import type { TuningAssets, TuningGroup, TuningParam, TuningParamType, TuningSchema } from './types';

export const GENERAL_GROUP = 'general';

/** Param types whose value lives in the VFS rather than in __TUNING__. */
export const ASSET_TYPES: TuningParamType[] = ['image', 'audio', 'video'];

export function isAssetParam(param: TuningParam): boolean {
    return ASSET_TYPES.includes(param.type);
}

const GROUP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface Section {
    id: string;
    title: string;
    description: string;
    collapsed: boolean;
    params: TuningParam[];
}

function groupOf(param: TuningParam): string {
    const id = param.group;
    return typeof id === 'string' && GROUP_ID.test(id) ? id : GENERAL_GROUP;
}

/**
 * A freshly built file already guarantees groups (tuning-groups.md §2); this only covers what
 * older builds and hand-edited schemas leave out — a missing list, or a param pointing at a
 * category nobody declared. Declared-but-empty groups are kept: they usually mean a typo in a
 * param's `group`, and showing the empty section is what makes that visible.
 */
export function sectionsOf(schema: TuningSchema | null, params?: TuningParam[]): Section[] {
    if (!schema) return [];
    const list = params ?? schema.params;
    const declared: TuningGroup[] = Array.isArray(schema.groups) ? schema.groups : [];

    const order: string[] = [];
    const byId = new Map<string, TuningGroup>();
    for (const group of declared) {
        if (!group || typeof group.id !== 'string' || !GROUP_ID.test(group.id) || byId.has(group.id)) continue;
        byId.set(group.id, group);
        order.push(group.id);
    }
    for (const param of schema.params) {
        const id = groupOf(param);
        if (byId.has(id)) continue;
        byId.set(id, { id, label: id === GENERAL_GROUP ? 'General' : id });
        order.push(id);
    }

    // The builder puts `general` last; keep that shape even when it had to be synthesised here.
    const generalIndex = order.indexOf(GENERAL_GROUP);
    if (generalIndex !== -1 && generalIndex !== order.length - 1) {
        order.splice(generalIndex, 1);
        order.push(GENERAL_GROUP);
    }

    return order.map((id) => {
        const group = byId.get(id)!;
        return {
            id,
            title: group.label || group.id,
            description: group.description ?? '',
            collapsed: Boolean(group.collapsed),
            params: list.filter((param) => groupOf(param) === id),
        };
    });
}

/** A schema with nothing but `general` is a schema without categories — no section chrome needed. */
export function isFlat(sections: Section[]): boolean {
    return sections.length <= 1;
}

export function matchesSection(section: Section, query: string): boolean {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [section.title, section.description].some((text) => text.toLowerCase().includes(needle));
}

/** Searching "hero" has to find both the hero's fields and the category they sit in. */
export function matchesQuery(param: TuningParam, section: Section, query: string): boolean {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    if (matchesSection(section, needle)) return true;
    return [param.label ?? '', param.key].some((text) => text.toLowerCase().includes(needle));
}

/** Image/audio params missing from `__TUNING_ASSETS__` did not make it into this build (atlas, compressed texture). */
export function isSwappable(param: TuningParam, assets: TuningAssets): boolean {
    if (!isAssetParam(param)) return true;
    return Boolean(assets[param.key]);
}
