import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import type { Translate } from '../i18n';
import { isAssetParam, isFlat, matchesQuery, matchesSection, sectionsOf } from '../core/schema';
import type { Section } from '../core/schema';
import { SectionNote } from './SectionNote';
import type { TuningParam, TuningSchema, TuningValues, ValueCheck } from '../core/types';

interface Props {
    schema: TuningSchema | null;
    values: TuningValues;
    onChange: (key: string, value: unknown) => void;
    onReset: () => void;
    onApplyPreset: (values: TuningValues) => void;
    /** What the running build said about a value, keyed by param key. */
    valueChecks?: Record<string, ValueCheck>;
    /** Ask the build to look at one. Absent when no build is running. */
    onCheck?: (key: string) => void;
}

/**
 * Long enough that a single-line input is the wrong shape for it.
 *
 * Read off the schema's own default rather than a flag, so it works for any
 * build: a parameter whose default runs to several lines, or to more text
 * than fits a field, is something you are meant to edit as a block -- a level
 * description, a config blob, a block of copy.
 */
const LONG_FORM_CHARS = 60;

function isLongForm(param: TuningParam): boolean {
    if (param.type !== 'string') return false;
    const sample = typeof param.default === 'string' ? param.default : '';
    return sample.includes('\n') || sample.length > LONG_FORM_CHARS;
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
            if (isLongForm(param)) {
                return (
                    <textarea
                        className="control control--wide control--area"
                        rows={10}
                        spellCheck={false}
                        value={String(value ?? '')}
                        onChange={(event) => onChange(event.target.value)}
                    />
                );
            }
            return (
                <input
                    className="control control--wide"
                    value={String(value ?? '')}
                    onChange={(event) => onChange(event.target.value)}
                />
            );
    }
}

function CheckReport({ check, t }: { check: ValueCheck; t: Translate }) {
    if (!check.supported) return <p className="field__note">{t('params.checkUnsupported')}</p>;

    const lines = [
        ...check.errors.map((text) => ({ kind: 'error' as const, text })),
        ...check.warnings.map((text) => ({ kind: 'warn' as const, text })),
        ...check.notes.map((text) => ({ kind: 'note' as const, text })),
    ];

    return (
        <div className={`field__check field__check--${check.ok ? 'ok' : 'bad'}`}>
            <strong>{check.ok ? t('params.checkOk') : t('params.checkBad')}</strong>
            {lines.length > 0 && (
                <ul>
                    {lines.map((line, index) => (
                        <li key={index} className={`field__check-${line.kind}`}>
                            {line.text}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function ParamRow({
    param,
    value,
    onChange,
    onCheck,
    check,
    t,
}: {
    param: TuningParam;
    value: unknown;
    onChange: (value: unknown) => void;
    onCheck?: () => void;
    check?: ValueCheck;
    t: Translate;
}) {
    // Only offered where it could matter: a one-line field has nothing the
    // build could usefully object to.
    const checkable = onCheck && isLongForm(param);

    return (
        <div className="field">
            <div className="field__head">
                <span className="field__label">{param.label ?? param.key}</span>
                {param.live && <span className="pill pill--live">{t('params.live')}</span>}
                <code className="field__key">{param.key}</code>
                {checkable && (
                    <button type="button" className="btn btn--ghost btn--tiny" onClick={onCheck}>
                        {t('params.check')}
                    </button>
                )}
            </div>
            <Field param={param} value={value} onChange={onChange} t={t} />
            {check && <CheckReport check={check} t={t} />}
        </div>
    );
}

export function ParamsPanel({
    schema,
    values,
    onChange,
    onReset,
    onApplyPreset,
    valueChecks,
    onCheck,
}: Props) {
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
                        onCheck={onCheck ? () => onCheck(param.key) : undefined}
                        check={valueChecks?.[param.key]}
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
                                {section.description && <SectionNote text={section.description} t={t} />}
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
