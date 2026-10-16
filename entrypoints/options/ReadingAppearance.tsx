import { useEffect, useRef, useState } from 'react';
import { useInterfaceTranslation } from '@/lib/i18n/i18n';
import {
  applyTranslationAppearance,
  DEFAULT_TRANSLATION_APPEARANCE,
  resolveTranslationAppearance,
  TRANSLATION_APPEARANCE_PRESETS,
  type TranslationAppearance,
  type TranslationAppearancePreset,
  translationAppearancePreset,
} from '@/lib/page-translation/appearance';
import '../page-translation.css';
import './ReadingAppearance.css';

type Props = {
  appearance: TranslationAppearance;
  onChange(appearance: TranslationAppearance): void;
};

export default function ReadingAppearance({ appearance, onChange }: Props) {
  const { t } = useInterfaceTranslation();
  const [darkPreview, setDarkPreview] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const preset = translationAppearancePreset(appearance);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Preview theme changes the computed source color copied into the translation.
  useEffect(() => {
    for (const source of preview.current?.querySelectorAll<HTMLElement>(
      '[data-lingo-source]',
    ) ?? []) {
      const translation = source.nextElementSibling;
      if (translation instanceof HTMLElement)
        applyTranslationAppearance(source, translation, appearance);
    }
  }, [appearance, darkPreview]);

  function change(patch: Partial<TranslationAppearance>) {
    onChange(resolveTranslationAppearance({ ...appearance, ...patch }));
  }

  return (
    <section
      className="reading-appearance"
      aria-labelledby="reading-appearance-title"
    >
      <div className="reading-appearance-heading">
        <div>
          <h2 id="reading-appearance-title">{t('readingAppearance.title')}</h2>
          <p>{t('readingAppearance.description')}</p>
        </div>
        <button
          type="button"
          className="reading-appearance-reset"
          onClick={() => onChange({ ...DEFAULT_TRANSLATION_APPEARANCE })}
        >
          {t('readingAppearance.reset')}
        </button>
      </div>
      <div className="reading-appearance-fields">
        <label>
          <span>{t('readingAppearance.preset')}</span>
          <select
            value={preset}
            onChange={(event) => {
              const next = event.target.value as TranslationAppearancePreset;
              if (next in TRANSLATION_APPEARANCE_PRESETS)
                onChange({ ...TRANSLATION_APPEARANCE_PRESETS[next] });
            }}
          >
            <option value="page">{t('readingAppearance.page')}</option>
            <option value="comfortable">
              {t('readingAppearance.comfortable')}
            </option>
            <option value="separated">
              {t('readingAppearance.separated')}
            </option>
            {preset === 'custom' && (
              <option value="custom">{t('readingAppearance.custom')}</option>
            )}
          </select>
        </label>
        <label>
          <span>{t('readingAppearance.fontFamily')}</span>
          <select
            value={appearance.fontFamily}
            onChange={(event) =>
              change({
                fontFamily: event.target
                  .value as TranslationAppearance['fontFamily'],
              })
            }
          >
            <option value="inherit">
              {t('readingAppearance.font.inherit')}
            </option>
            <option value="sans-serif">
              {t('readingAppearance.font.sans')}
            </option>
            <option value="serif">{t('readingAppearance.font.serif')}</option>
          </select>
        </label>
        <label>
          <span>
            {t('readingAppearance.fontScale')}{' '}
            <output>{Math.round(appearance.fontScale * 100)}%</output>
          </span>
          <input
            type="range"
            min="80"
            max="140"
            step="5"
            value={Math.round(appearance.fontScale * 100)}
            onChange={(event) =>
              change({ fontScale: Number(event.target.value) / 100 })
            }
          />
        </label>
        <label>
          <span>
            {t('readingAppearance.paragraphGap')}{' '}
            <output>{appearance.paragraphGap.toFixed(2)} em</output>
          </span>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.05"
            value={appearance.paragraphGap}
            onChange={(event) =>
              change({ paragraphGap: Number(event.target.value) })
            }
          />
        </label>
        <div className="reading-appearance-line-height">
          <label>
            <span>
              {t('readingAppearance.lineHeight')}{' '}
              <output>{appearance.lineHeight ?? '—'}</output>
            </span>
            <input
              type="range"
              min="1.2"
              max="2.2"
              step="0.1"
              value={appearance.lineHeight ?? 1.6}
              disabled={appearance.lineHeight === null}
              onChange={(event) =>
                change({ lineHeight: Number(event.target.value) })
              }
            />
          </label>
          <label className="reading-appearance-checkbox">
            <input
              type="checkbox"
              checked={appearance.lineHeight === null}
              onChange={(event) =>
                change({ lineHeight: event.target.checked ? null : 1.6 })
              }
            />
            {t('readingAppearance.lineHeight.inherit')}
          </label>
        </div>
        <label>
          <span>{t('readingAppearance.separator')}</span>
          <select
            value={appearance.separator}
            onChange={(event) =>
              change({
                separator: event.target
                  .value as TranslationAppearance['separator'],
              })
            }
          >
            <option value="none">
              {t('readingAppearance.separator.none')}
            </option>
            <option value="line">
              {t('readingAppearance.separator.line')}
            </option>
            <option value="dashed">
              {t('readingAppearance.separator.dashed')}
            </option>
            <option value="border">
              {t('readingAppearance.separator.border')}
            </option>
          </select>
        </label>
        <div className="reading-appearance-color">
          <label>
            <span>{t('readingAppearance.color')}</span>
            <select
              value={appearance.color === null ? 'inherit' : 'custom'}
              onChange={(event) =>
                change({
                  color: event.target.value === 'inherit' ? null : '#476b52',
                })
              }
            >
              <option value="inherit">
                {t('readingAppearance.color.inherit')}
              </option>
              <option value="custom">
                {t('readingAppearance.color.custom')}
              </option>
            </select>
          </label>
          {appearance.color !== null && (
            <label className="reading-appearance-color-picker">
              <input
                aria-label={t('readingAppearance.color.custom')}
                type="color"
                value={appearance.color}
                onChange={(event) => change({ color: event.target.value })}
              />
              <span>{appearance.color.toUpperCase()}</span>
            </label>
          )}
        </div>
      </div>
      <div className="reading-appearance-preview-heading">
        <span>{t('readingAppearance.preview')}</span>
        <fieldset
          className="reading-appearance-preview-theme"
          aria-label={t('readingAppearance.preview')}
        >
          <button
            type="button"
            aria-pressed={!darkPreview}
            onClick={() => setDarkPreview(false)}
          >
            {t('readingAppearance.preview.light')}
          </button>
          <button
            type="button"
            aria-pressed={darkPreview}
            onClick={() => setDarkPreview(true)}
          >
            {t('readingAppearance.preview.dark')}
          </button>
        </fieldset>
      </div>
      <div
        ref={preview}
        className="reading-appearance-preview"
        data-preview-theme={darkPreview ? 'dark' : 'light'}
      >
        <h3 data-lingo-source="">{t('readingAppearance.preview.heading')}</h3>
        <h3
          data-lingo-translation="preview-heading"
          data-lingo-display="bilingual"
        >
          {t('readingAppearance.preview.headingTranslation')}
        </h3>
        <p data-lingo-source="">{t('readingAppearance.preview.source')}</p>
        <p data-lingo-translation="preview-body" data-lingo-display="bilingual">
          {t('readingAppearance.preview.translation')}
        </p>
      </div>
      <p className="reading-appearance-saved-hint">
        {t('readingAppearance.savedHint')}
      </p>
    </section>
  );
}
