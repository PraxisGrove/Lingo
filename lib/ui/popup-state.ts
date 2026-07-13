import type { SessionSnapshot } from '../page-translation/page-translation';
import type { ExtensionSettings } from '../storage/settings-model';

export type PopupNotice = {
  kind:
    | 'disabled'
    | 'no-service'
    | 'no-permission'
    | 'unsupported-page'
    | 'quota'
    | 'authentication'
    | 'rate-limit'
    | 'translation-error';
  title: string;
  message: string;
  action?: 'Open settings' | 'Review service' | 'Retry translation';
};

export function resolvePopupNotice(
  settings: ExtensionSettings,
  hostPermissionGranted: boolean,
  page: SessionSnapshot | null,
): PopupNotice | null {
  if (!settings.enabled) {
    return {
      kind: 'disabled',
      title: 'Lingo is paused',
      message: 'Enable Lingo in settings to translate webpages.',
      action: 'Open settings',
    };
  }
  if (
    settings.providerProfiles.length === 0 ||
    !settings.activeProviderProfileId
  ) {
    return {
      kind: 'no-service',
      title: 'Connect a translation service',
      message: 'Choose where webpage text is sent before translating.',
      action: 'Open settings',
    };
  }
  if (!hostPermissionGranted) {
    return {
      kind: 'no-permission',
      title: 'Page access is unavailable',
      message: 'Lingo needs permission to read and present this webpage.',
      action: 'Open settings',
    };
  }
  if (!page) {
    return {
      kind: 'unsupported-page',
      title: 'This page cannot be translated',
      message:
        'Browser settings, store pages, and internal pages are protected.',
    };
  }
  if (!page.failure) return null;

  if (page.failure.category === 'quota') {
    return {
      kind: 'quota',
      title: 'Service balance is insufficient',
      message: page.failure.message,
      action: 'Review service',
    };
  }
  if (page.failure.category === 'authentication') {
    return {
      kind: 'authentication',
      title: 'Service credentials were rejected',
      message: page.failure.message,
      action: 'Review service',
    };
  }
  if (page.failure.category === 'rate-limit') {
    return {
      kind: 'rate-limit',
      title: 'Service is temporarily limited',
      message: page.failure.message,
      action: 'Retry translation',
    };
  }
  return {
    kind: 'translation-error',
    title: 'Translation stopped',
    message: page.failure.message,
    action: 'Retry translation',
  };
}
