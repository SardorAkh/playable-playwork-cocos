import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import type { Translate } from '../i18n';
import { isAssetParam, isFlat, matchesQuery, matchesSection, sectionsOf } from '../core/schema';
import type { Section } from '../core/schema';
import type { TuningParam, TuningSchema, TuningValues } from '../core/types';

interface Props {
    schema: TuningSchema | null;
    values: TuningValues;
    onChange: (key: string, value: unknown) => void;
    onReset: () => void;
    onApplyPreset: (values: TuningValues) => void;
}

const PRESETS_KEY = 'playable-tuner:presets';

type PresetStore = Record<string, TuningValues>;

function readPresets(): PresetStore {
    try {
        return JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '{}') as PresetStore;
    } catch {
        return {};
    }
}

function writePresets(store: PresetStore): void {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(store));
}

function Field({
    param,
    value,
    onChange,
    t,
}: {
    param: TuningParam;
    value: unknown;
    onChange: (value: unknown) => void;
    t: Translate;
}) {
    switch (param.type) {
        case 'number': {
            const current = typeof value === 'number' ? value : Number(param.default ?? 0);
            const bounded = param.min !== undefined && param.max !== undefined;
            return (
                <div className="field__input field__input--row">
                    {bounded && (
                        <input
                            type="range"
                            min={param.min}
                            max={param.max}
                            step={param.step ?? 'any'}
                            value={current}
                            onChange={(event) => onChange(Number(event.target.value))}
                        />
                    )}
                    <input
                        className="control control--num"
                        type="number"
                        min={param.min}
                        max={param.max}
                        step={param.step ?? 'any'}
                        value={current}
                        onChange={(event) => onChange(Number(event.target.value))}
                    />
                </div>
            );
        }
        case 'boolean':
            return (
                <label className="check">
                    <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
                    {value === true ? t('params.on') : t('params.off')}
                </label>
            );
        case 'select':
            return (
                <select
                    className="control control--wide"
                    value={String(value ?? '')}
                    onChange={(event) => onChange(event.target.value)}
                >
                    {(param.options ?? []).map((option) => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </select>
            );
        case 'color':
            return (
                <div className="field__input field__input--row">
                    <input
                        type="color"
                        className="control control--color"
                        value={/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : '#ffffff'}
                        onChange={(event) => onChange(event.target.value)}
                    />
                    <input
                        className="control control--wide"
                        value={String(value ?? '')}
                        onChange={(event) => onChange(event.target.value)}
                    />
                </div>
            );
        default:
            return (
                <input
                    className="control control--wide"
                    value={String(value ?? '')}
                    onChange={(event) => onChange(event.target.value)}
                />
            );
    }
}

function ParamRow({
    param,
    value,
    onChange,
    t,
}: {
    param: TuningParam;
    value: unknown;
    onChange: (value: unknown) => void;
    t: Translate;
}) {
    return (
        <div className="field">
            <div className="field__head">
                <span className="field__label">{param.label ?? param.key}</span>
                {param.live && <span className="pill pill--live">{t('params.live')}</span>}
                <code className="field__key">{param.key}</code>
            </div>
            <Field param={param} value={value} onChange={onChange} t={t} />
        </div>
    );
}

export function ParamsPanel({ schema, values, onChange, onReset, onApplyPreset }: Props) {
    const { t } = useI18n();
    const [presets, setPresets] = useState<PresetStore>(readPresets);
    const [query, setQuery] = useState('');
    const [closed, setClosed] = useState<Record<string, boolean>>({});

    // Categories are presentational only, so their order is the schema's order — never sorted.
    const sections = useMemo(() => sectionsOf(schema), [schema]);
    const editableSections: Section[] = useMemo(
        () =>
            sections.map((section) => ({
                ...section,
                params: section.params.filter((param) => !isAssetParam(param)),
            })),
        [sections],
    );

    useEffect(() => {
        const initial: Record<string, boolean> = {};
        for (const section of sections) if (section.collapsed) initial[section.id] = true;
        setClosed(initial);
    }, [sections]);

    const hasParams = editableSections.some((section) => section.params.length > 0);
    const flat = isFlat(editableSections);

    const savePreset = () => {
        const name = window.prompt(t('params.presetName'));
        if (!name) return;
        const next = { ...presets, [name]: { ...values } };
        writePresets(next);
        setPresets(next);
    };

    const removePreset = (name: string) => {
        const next = { ...presets };
        delete next[name];
        writePresets(next);
        setPresets(next);
    };

    const exportPreset = () => {
        const blob = new Blob([JSON.stringify(values, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'tuning-preset.json';
        link.click();
        URL.revokeObjectURL(link.href);
    };

    const importPreset = (file: File | undefined) => {
        if (!file) return;
        file.text().then((text) => {
            try {
                onApplyPreset(JSON.parse(text) as TuningValues);
            } catch {
                window.alert(t('params.presetBroken'));
            }
        });
    };

    if (!hasParams) {
        return <div className="panel__empty">{t('params.none')}</div>;
    }

    return (
        <div className="panel__body">
            <div className="panel__tools">
                <select
                    className="control"
                    value=""
                    onChange={(event) => {
                        const preset = presets[event.target.value];
                        if (preset) onApplyPreset(preset);
                    }}
                >
                    <option value="">{t('params.presets')}</option>
                    {Object.keys(presets).map((name) => (
                        <option key={name} value={name}>
                            {name}
                        </option>
                    ))}
                </select>
                <button className="control" onClick={savePreset}>
                    {t('params.save')}
                </button>
                <button className="control" onClick={exportPreset}>
                    {t('params.export')}
                </button>
                <label className="control control--file">
                    {t('params.import')}
                    <input type="file" accept="application/json" onChange={(event) => importPreset(event.target.files?.[0])} />
                </label>
                <button className="control" onClick={onReset} title={t('params.resetHint')}>
                    {t('params.reset')}
                </button>
            </div>

            {Object.keys(presets).length > 0 && (
                <div className="chips">
                    {Object.keys(presets).map((name) => (
                        <span className="chip" key={name}>
                            {name}
                            <button onClick={() => removePreset(name)} title={t('params.deletePreset')}>
                                ×
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {!flat && (
                <input
                    className="control control--wide"
                    placeholder={t('params.search')}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
            )}

            {editableSections.map((section) => {
                const visible = section.params.filter((param) => matchesQuery(param, section, query));
                if (query && visible.length === 0 && !matchesSection(section, query)) return null;
                // A category holding only image/audio params is not empty — its fields live on the
                // Assets tab, and saying so beats showing the "probably a typo" warning.
                const total = sections.find((item) => item.id === section.id)?.params.length ?? 0;
                const assetsOnly = section.params.length === 0 && total > 0;

                const rows = visible.map((param) => (
                    <ParamRow
                        key={param.key}
                        param={param}
                        value={values[param.key]}
                        onChange={(value) => onChange(param.key, value)}
                        t={t}
                    />
                ));

                if (flat) return <div key={section.id}>{rows}</div>;

                const isClosed = Boolean(closed[section.id]) && !query;
                return (
                    <section className="section" key={section.id}>
                        <button
                            className="section__head"
                            onClick={() => setClosed((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
                        >
                            <span className={isClosed ? 'section__arrow' : 'section__arrow is-open'}>▸</span>
                            <span className="section__title">{section.title}</span>
                            <span className="section__count">{total}</span>
                        </button>
                        {!isClosed && (
                            <div className="section__body">
                                {section.description && <div className="section__note">{section.description}</div>}
                                {section.params.length > 0 && rows}
                                {assetsOnly && (
                                    <div className="section__note">{t('params.assetsOnly', { count: total })}</div>
                                )}
                                {!assetsOnly && section.params.length === 0 && (
                                    <div className="section__empty">{t('params.emptyGroup')}</div>
                                )}
                            </div>
                        )}
                    </section>
                );
            })}
        </div>
    );
}
