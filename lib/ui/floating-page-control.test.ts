// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import type { PageTranslation } from '../page-translation/page-translation';
import { DEFAULT_SETTINGS } from '../storage/settings-model';
import { createFloatingPageControl } from './floating-page-control';

function pageTranslation(): PageTranslation {
  return {
    start: vi.fn<PageTranslation['start']>(async () => ({
      status: 'translating',
      displayMode: 'bilingual',
      translatedUnitCount: 0,
      failedUnitCount: 0,
      totalUnitCount: 2,
      pageRevision: 0,
    })),
    update: vi.fn(),
    stop: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    snapshot: vi.fn<PageTranslation['snapshot']>(() => ({
      status: 'idle',
      displayMode: 'bilingual',
      translatedUnitCount: 0,
      failedUnitCount: 0,
      totalUnitCount: 0,
      pageRevision: 0,
    })),
  };
}

describe('floating page control', () => {
  it('is opt-in and only renders in the top frame', () => {
    const topControl = createFloatingPageControl({
      document,
      isTopFrame: true,
      pageTranslation: pageTranslation(),
      translate: (key) => key,
    });
    topControl.update(DEFAULT_SETTINGS);
    expect(document.querySelector('[data-lingo-floating-control]')).toBeNull();

    topControl.update({ ...DEFAULT_SETTINGS, floatingButtonEnabled: true });
    expect(
      document.querySelector('[data-lingo-floating-control]'),
    ).not.toBeNull();
    topControl.dispose();

    const frameControl = createFloatingPageControl({
      document,
      isTopFrame: false,
      pageTranslation: pageTranslation(),
      translate: (key) => key,
    });
    frameControl.update({ ...DEFAULT_SETTINGS, floatingButtonEnabled: true });
    expect(document.querySelector('[data-lingo-floating-control]')).toBeNull();
  });

  it('starts translation from the accessible page control', async () => {
    const session = pageTranslation();
    const control = createFloatingPageControl({
      document,
      isTopFrame: true,
      pageTranslation: session,
      translate: (key) =>
        key === 'floating.translate' ? 'Translate page with Lingo' : key,
    });
    control.update({
      ...DEFAULT_SETTINGS,
      floatingButtonEnabled: true,
      targetLanguage: 'ja',
    });

    const button = document
      .querySelector<HTMLElement>('[data-lingo-floating-control]')
      ?.shadowRoot?.querySelector<HTMLButtonElement>('button');
    expect(button?.getAttribute('aria-label')).toBe(
      'Translate page with Lingo',
    );
    button?.click();
    await Promise.resolve();

    expect(session.start).toHaveBeenCalledWith({
      targetLanguage: 'ja',
      displayMode: 'bilingual',
      translateImmediately: false,
    });
    control.dispose();
  });
});
