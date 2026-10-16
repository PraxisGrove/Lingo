import { useEffect, useState } from 'react';
import { useInterfaceTranslation } from '@/lib/i18n/i18n';
import { createLogger } from '@/lib/logger/logger';
import {
  DEFAULT_VOCABULARY,
  exportWordbook,
  VOCABULARY_SIZES,
  type VocabularySettings as Vocabulary,
} from '@/lib/vocabulary/vocabulary-model';
import {
  getVocabulary,
  updateVocabulary,
  watchVocabulary,
} from '@/lib/vocabulary/vocabulary-store';

const logger = createLogger('vocabulary-settings');

export default function VocabularySettings({
  hidden,
  serviceName,
}: {
  hidden: boolean;
  serviceName?: string;
}) {
  const { t } = useInterfaceTranslation();
  const [vocabulary, setVocabulary] = useState<Vocabulary>(DEFAULT_VOCABULARY);
  const [status, setStatus] = useState('');

  useEffect(() => {
    void getVocabulary().then(setVocabulary);
    return watchVocabulary(setVocabulary);
  }, []);

  async function change(patch: Partial<Vocabulary>) {
    setStatus('');
    try {
      setVocabulary(await updateVocabulary(() => patch));
    } catch (error) {
      logger.error('Could not save vocabulary preferences.', { error });
      setStatus(t('vocabulary.settings.saveFailed'));
    }
  }

  function download() {
    const blob = new Blob([exportWordbook(vocabulary.savedWords)], {
      type: 'text/tab-separated-values;charset=utf-8',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'lingo-wordbook.tsv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <section
      className="panel"
      aria-labelledby="vocabulary-heading"
      hidden={hidden}
    >
      <h2 id="vocabulary-heading">{t('vocabulary.settings.title')}</h2>
      <p className="section-description">
        {t('vocabulary.settings.description')}
      </p>
      <label className="row">
        <span>
          <strong>{t('vocabulary.settings.enabled')}</strong>
          <small>
            {t('vocabulary.settings.privacy', {
              service: serviceName ?? t('vocabulary.settings.noService'),
            })}
          </small>
        </span>
        <input
          type="checkbox"
          checked={vocabulary.enabled}
          onChange={(event) =>
            void change({ enabled: event.currentTarget.checked })
          }
        />
      </label>
      <label className="row">
        <span>
          <strong>{t('vocabulary.settings.level')}</strong>
          <small>{t('vocabulary.settings.levelHelp')}</small>
        </span>
        <select
          value={vocabulary.vocabularySize}
          disabled={!vocabulary.enabled}
          onChange={(event) =>
            void change({ vocabularySize: Number(event.currentTarget.value) })
          }
        >
          {VOCABULARY_SIZES.map((size) => (
            <option key={size} value={size}>
              {t('vocabulary.settings.levelOption', { count: size })}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <span>
          <strong>{t('vocabulary.settings.known')}</strong>
          <small>
            {t('vocabulary.settings.knownCount', {
              count: vocabulary.knownWords.length,
            })}
          </small>
        </span>
        <button
          className="secondary-button"
          type="button"
          disabled={vocabulary.knownWords.length === 0}
          onClick={() => void change({ knownWords: [] })}
        >
          {t('vocabulary.settings.resetKnown')}
        </button>
      </div>
      <div className="row">
        <span>
          <strong>{t('vocabulary.settings.wordbook')}</strong>
          <small>
            {t('vocabulary.settings.wordbookCount', {
              count: vocabulary.savedWords.length,
            })}
          </small>
        </span>
        <span className="vocabulary-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={vocabulary.savedWords.length === 0}
            onClick={download}
          >
            {t('vocabulary.settings.export')}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={vocabulary.savedWords.length === 0}
            onClick={() => void change({ savedWords: [] })}
          >
            {t('vocabulary.settings.clearWordbook')}
          </button>
        </span>
      </div>
      {vocabulary.savedWords.length > 0 && (
        <ul className="vocabulary-wordbook">
          {vocabulary.savedWords.slice(0, 50).map((item) => (
            <li key={item.word}>
              <strong>{item.word}</strong>
              <span>{item.gloss}</span>
              <button
                className="text-button"
                type="button"
                aria-label={t('vocabulary.settings.remove', {
                  word: item.word,
                })}
                onClick={() =>
                  void change({
                    savedWords: vocabulary.savedWords.filter(
                      (saved) => saved.word !== item.word,
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
      <p className="connection-status" role="status">
        {status}
      </p>
      <small className="vocabulary-attribution">
        {t('vocabulary.settings.attribution')}
      </small>
    </section>
  );
}
