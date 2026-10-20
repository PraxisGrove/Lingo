import { changeInterfaceLanguage, translate } from '@/lib/i18n/i18n';
import { createLogger } from '@/lib/logger/logger';
import { isExtensionMessage } from '@/lib/messaging/messages';
import { sendMessage } from '@/lib/messaging/send-message';
import { createTranslationPortClient } from '@/lib/messaging/translation-port';
import { startAutomaticTranslation } from '@/lib/page-translation/automatic-session';
import { createPageTranslation } from '@/lib/page-translation/page-translation';
import { getPageRules } from '@/lib/rules/page-rules';
import { getSettings, watchSettings } from '@/lib/storage/settings';
import { createSubtitleLayer } from '@/lib/subtitles/subtitle-layer';
import {
  getSubtitlePreferences,
  watchSubtitlePreferences,
} from '@/lib/subtitles/subtitle-store';
import { createFloatingPageControl } from '@/lib/ui/floating-page-control';
import { createTextTools } from '@/lib/ui/text-tools';
import { createVocabularyLayer } from '@/lib/vocabulary/vocabulary-layer';
import { normalizeWord } from '@/lib/vocabulary/vocabulary-model';
import {
  getVocabulary,
  updateVocabulary,
  watchVocabulary,
} from '@/lib/vocabulary/vocabulary-store';
import './page-translation.css';
import pageTranslationStyle from './page-translation.css?inline';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  main() {
    const logger = createLogger('content');
    const client = createTranslationPortClient();
    let onNavigation = () => {};
    const pageTranslation = createPageTranslation({
      document,
      shadowStyle: pageTranslationStyle,
      translate: client.translate,
      cancel: client.cancel,
      getRuleSelectors: async () =>
        (await getPageRules(location.hostname)).selectors,
      watchNavigation: (listener) => {
        onNavigation = listener;
        return () => {
          onNavigation = () => {};
        };
      },
      logger,
    });
    const textTools = createTextTools({
      document,
      client: createTranslationPortClient(),
      getSettings,
      t: translate,
      getRuleSelectors: async () =>
        (await getPageRules(location.hostname)).selectors,
      openSettings: () => {
        void sendMessage('openSettings', {}).catch((error) =>
          logger.error('Could not open settings.', { error }),
        );
      },
    });
    const vocabularyLayer = createVocabularyLayer({
      document,
      client: createTranslationPortClient(),
      classify: async (words) =>
        (await sendMessage('classifyWords', { words })).ranks,
      getRuleSelectors: async () =>
        (await getPageRules(location.hostname)).selectors,
      t: translate,
      markKnown: async (lemma) => {
        await updateVocabulary((current) => ({
          knownWords: [...current.knownWords, normalizeWord(lemma)],
        }));
      },
      save: async (entry) => {
        await updateVocabulary((current) => ({
          savedWords: [
            { ...entry, addedAt: Date.now() },
            ...current.savedWords.filter((item) => item.word !== entry.word),
          ],
        }));
      },
    });
    const subtitleLayer = createSubtitleLayer({
      document,
      hostname: location.hostname,
      client: createTranslationPortClient(),
      t: translate,
      async fetchCrossOrigin(url) {
        const result = await sendMessage('fetchCaptionFile', { url });
        if (!result.ok) throw new Error('Caption file unavailable.');
        return result.text;
      },
    });
    let displayMode = pageTranslation.snapshot().displayMode;
    pageTranslation.subscribe(({ snapshot }) => {
      if (snapshot.displayMode === displayMode) return;
      displayMode = snapshot.displayMode;
      vocabularyLayer.refresh();
    });
    const floatingControl = createFloatingPageControl({
      document,
      isTopFrame: window.top === window,
      pageTranslation,
      translate,
    });

    browser.runtime.onMessage.addListener((message) => {
      if (!isExtensionMessage(message)) return undefined;

      switch (message.type) {
        case 'getSubtitleState':
          return Promise.resolve(subtitleLayer.snapshot());
        case 'startSubtitles':
          return Promise.resolve(subtitleLayer.start());
        case 'stopSubtitles':
          return Promise.resolve(subtitleLayer.stop());
        case 'runTextAction':
          textTools.execute(message.payload.action);
          return Promise.resolve({ ok: true });
        case 'pageNavigation':
          textTools.suspend();
          onNavigation();
          vocabularyLayer.refresh();
          subtitleLayer.navigate();
          return Promise.resolve(pageTranslation.snapshot());
        case 'getPageTranslation':
          return Promise.resolve(pageTranslation.snapshot());
        case 'startPageTranslation':
          void pageTranslation.start(message.payload).catch((error) => {
            logger.error('Could not start page translation.', { error });
          });
          return Promise.resolve(pageTranslation.snapshot());
        case 'updatePageTranslation':
          void pageTranslation.update(message.payload).catch((error) => {
            logger.error('Could not update page translation.', { error });
          });
          return Promise.resolve(pageTranslation.snapshot());
        case 'stopPageTranslation':
          return pageTranslation.stop().then(() => pageTranslation.snapshot());
        default:
          return undefined;
      }
    });

    void getSettings()
      .then(async (settings) => {
        pageTranslation.updateAppearance(settings.translationAppearance);
        await changeInterfaceLanguage(settings.uiLocale);
        floatingControl.update(settings);
        textTools.update(settings);
        vocabularyLayer.updateSettings(settings);
        vocabularyLayer.updateVocabulary(await getVocabulary());
        subtitleLayer.updateSettings(settings);
        subtitleLayer.updatePreferences(await getSubtitlePreferences());
      })
      .catch((error) => {
        logger.error('Could not initialize content settings.', { error });
      });
    const unwatchVocabulary = watchVocabulary((vocabulary) =>
      vocabularyLayer.updateVocabulary(vocabulary),
    );
    const unwatchSubtitles = watchSubtitlePreferences((preferences) =>
      subtitleLayer.updatePreferences(preferences),
    );
    const unwatchSettings = watchSettings((settings) => {
      pageTranslation.updateAppearance(settings.translationAppearance);
      void changeInterfaceLanguage(settings.uiLocale)
        .then(() => {
          floatingControl.update(settings);
          textTools.update(settings);
          vocabularyLayer.updateSettings(settings);
          subtitleLayer.updateSettings(settings);
        })
        .catch((error) => {
          logger.error('Could not apply updated content settings.', { error });
        });
    });
    void startAutomaticTranslation(pageTranslation, document).catch((error) => {
      logger.error('Automatic page translation failed.', { error });
    });

    window.addEventListener('pagehide', (event) => {
      if (event.persisted) {
        textTools.suspend();
        void pageTranslation.stop();
        return;
      }
      try {
        unwatchSettings();
        unwatchVocabulary();
        vocabularyLayer.dispose();
        unwatchSubtitles();
        subtitleLayer.dispose();
        floatingControl.dispose();
        textTools.dispose();
        client.disconnect();
      } catch (error) {
        logger.warn('Content script cleanup was interrupted.', { error });
      }
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        void startAutomaticTranslation(pageTranslation, document).catch(
          (error) => {
            logger.error('Could not restore automatic page translation.', {
              error,
            });
          },
        );
      }
    });
  },
});
