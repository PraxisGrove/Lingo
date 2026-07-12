// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { createInMemoryProvider } from '../providers/in-memory';
import { createTranslationOrchestrator } from '../translation/orchestrator';
import type { TranslationUnit } from '../translation/types';
import { createPageTranslation } from './page-translation';

describe('static article translation flow', () => {
  it('translates an article through both public interfaces and restores it', async () => {
    document.body.innerHTML = '<main><p>Hello from the article.</p></main>';
    const orchestrator = createTranslationOrchestrator(
      createInMemoryProvider(),
    );
    const pageTranslation = createPageTranslation({
      document,
      async translate(units, targetLanguage) {
        const translations: TranslationUnit[] = [];
        for await (const event of orchestrator.translate({
          sessionId: 'fixture-session',
          pageRevision: 0,
          sourceLanguage: 'auto',
          targetLanguage,
          units,
        })) {
          if (event.type === 'translated') {
            translations.push({ id: event.unitId, text: event.text });
          }
        }
        return translations;
      },
    });

    await pageTranslation.start({
      targetLanguage: 'zh-CN',
      displayMode: 'bilingual',
    });
    expect(document.body.textContent).toContain(
      '[zh-CN] Hello from the article.',
    );

    await pageTranslation.stop();
    expect(document.body.innerHTML).toBe(
      '<main><p>Hello from the article.</p></main>',
    );
  });
});
