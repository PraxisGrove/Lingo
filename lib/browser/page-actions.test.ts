import { describe, expect, it, vi } from 'vitest';
import { SUPPORTED_UI_LOCALES } from '../i18n/locales';
import { resources } from '../i18n/resources';
import type { SessionSnapshot } from '../page-translation/page-translation';
import { createPageActions, localizePageContextMenus } from './page-actions';

const IDLE: SessionSnapshot = {
  status: 'idle',
  displayMode: 'bilingual',
  translatedUnitCount: 0,
  failedUnitCount: 0,
  totalUnitCount: 0,
  pageRevision: 0,
};

describe('page actions', () => {
  it('uses the active tab and configured target language for toggle', async () => {
    const start = vi.fn();
    const actions = createPageActions({
      getActiveTabId: async () => 7,
      getTargetLanguage: async () => 'ja',
      getSnapshot: async () => IDLE,
      start,
      update: vi.fn(),
      stop: vi.fn(),
    });

    await actions.run('toggle');

    expect(start).toHaveBeenCalledWith(7, {
      targetLanguage: 'ja',
      displayMode: 'bilingual',
      translateImmediately: false,
    });
  });

  it('translates all remaining content in an active session', async () => {
    const update = vi.fn();
    const actions = createPageActions({
      getActiveTabId: async () => undefined,
      getTargetLanguage: async () => 'zh-CN',
      getSnapshot: async () => ({ ...IDLE, status: 'translated' }),
      start: vi.fn(),
      update,
      stop: vi.fn(),
    });

    await actions.run('translate-all', 9);

    expect(update).toHaveBeenCalledWith(9, {
      displayMode: 'bilingual',
      translateImmediately: true,
    });
  });

  it.each(SUPPORTED_UI_LOCALES)('localizes context menus in %s', (locale) => {
    const menus = localizePageContextMenus(
      (key) => (resources[locale].translation as Record<string, string>)[key],
    );

    expect(menus.map((menu) => menu.title)).toEqual([
      resources[locale].translation['menu.translate'],
      resources[locale].translation['menu.translateAll'],
      resources[locale].translation['menu.restore'],
    ]);
  });
});
