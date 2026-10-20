import { useEffect, useState } from 'react';
import { useInterfaceTranslation } from '@/lib/i18n/i18n';
import {
  DEFAULT_SUBTITLES,
  FONT_SCALES,
  type SubtitlePreferences,
} from '@/lib/subtitles/subtitle-model';
import {
  getSubtitlePreferences,
  updateSubtitlePreferences,
  watchSubtitlePreferences,
} from '@/lib/subtitles/subtitle-store';

export default function SubtitleSettings({ hidden }: { hidden: boolean }) {
  const { t } = useInterfaceTranslation();
  const [preferences, setPreferences] =
    useState<SubtitlePreferences>(DEFAULT_SUBTITLES);

  useEffect(() => {
    void getSubtitlePreferences().then(setPreferences);
    return watchSubtitlePreferences(setPreferences);
  }, []);

  async function change(patch: Partial<SubtitlePreferences>) {
    setPreferences(await updateSubtitlePreferences(() => patch));
  }

  return (
    <section
      className="panel"
      aria-labelledby="subtitles-heading"
      hidden={hidden}
    >
      <h2 id="subtitles-heading">{t('subtitles.settings.title')}</h2>
      <p className="section-description">
        {t('subtitles.settings.description')}
      </p>
      <label className="row">
        <span>
          <strong>{t('subtitles.settings.displayMode')}</strong>
        </span>
        <select
          value={preferences.displayMode}
          onChange={(event) =>
            void change({
              displayMode:
                event.currentTarget.value === 'translation'
                  ? 'translation'
                  : 'bilingual',
            })
          }
        >
          <option value="bilingual">{t('subtitles.settings.bilingual')}</option>
          <option value="translation">
            {t('subtitles.settings.translationOnly')}
          </option>
        </select>
      </label>
      <label className="row">
        <span>
          <strong>{t('subtitles.settings.fontScale')}</strong>
        </span>
        <select
          value={preferences.fontScale}
          onChange={(event) =>
            void change({ fontScale: Number(event.currentTarget.value) })
          }
        >
          {FONT_SCALES.map((scale) => (
            <option key={scale} value={scale}>
              {Math.round(scale * 100)}%
            </option>
          ))}
        </select>
      </label>
      <label className="row">
        <span>
          <strong>{t('subtitles.settings.playerButton')}</strong>
          <small>{t('subtitles.settings.playerButtonHelp')}</small>
        </span>
        <input
          type="checkbox"
          checked={preferences.playerButton}
          onChange={(event) =>
            void change({ playerButton: event.currentTarget.checked })
          }
        />
      </label>
      <div className="row subtitle-sites">
        <span>
          <strong>{t('subtitles.settings.autoStart')}</strong>
          <small>{t('subtitles.settings.autoStartHelp')}</small>
          {preferences.autoStartHosts.length === 0 ? (
            <small>{t('subtitles.settings.autoStartNone')}</small>
          ) : (
            <ul className="vocabulary-wordbook">
              {preferences.autoStartHosts.map((host) => (
                <li key={host}>
                  <strong>{host}</strong>
                  <span />
                  <button
                    className="text-button"
                    type="button"
                    aria-label={t('subtitles.settings.remove', { host })}
                    onClick={() =>
                      void change({
                        autoStartHosts: preferences.autoStartHosts.filter(
                          (item) => item !== host,
                        ),
                      })
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </span>
      </div>
    </section>
  );
}
