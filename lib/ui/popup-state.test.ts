import { describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '../page-translation/page-translation';
import { DEFAULT_SETTINGS } from '../storage/settings-model';
import { resolvePopupNotice } from './popup-state';

const READY_PAGE: SessionSnapshot = {
  status: 'idle',
  displayMode: 'bilingual',
  translatedUnitCount: 0,
  failedUnitCount: 0,
  totalUnitCount: 0,
  pageRevision: 0,
};

describe('resolvePopupNotice', () => {
  it('guides users to configure a service before translating', () => {
    expect(
      resolvePopupNotice(DEFAULT_SETTINGS, true, READY_PAGE),
    ).toMatchObject({ kind: 'no-service', action: 'open-settings' });
  });

  it('distinguishes missing permission from an unsupported page', () => {
    const configured = {
      ...DEFAULT_SETTINGS,
      activeProviderProfileId: 'personal',
      providerProfiles: [
        { id: 'personal', name: 'Personal', provider: 'deepl' as const },
      ],
    };
    expect(resolvePopupNotice(configured, false, READY_PAGE)).toMatchObject({
      kind: 'no-permission',
    });
    expect(resolvePopupNotice(configured, true, null)).toMatchObject({
      kind: 'unsupported-page',
    });
  });

  it('offers a billing recovery action for quota failures', () => {
    const configured = {
      ...DEFAULT_SETTINGS,
      activeProviderProfileId: 'personal',
      providerProfiles: [
        { id: 'personal', name: 'Personal', provider: 'deepl' as const },
      ],
    };
    expect(
      resolvePopupNotice(configured, true, {
        ...READY_PAGE,
        status: 'translated',
        translatedUnitCount: 1,
        failedUnitCount: 1,
        totalUnitCount: 2,
        failure: { category: 'quota', message: 'Balance exhausted.' },
      }),
    ).toMatchObject({
      kind: 'quota',
      action: 'review-service',
      detail: 'Balance exhausted.',
    });
  });
});
