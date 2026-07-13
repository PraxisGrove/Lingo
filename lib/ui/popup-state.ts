import type { MessageKey } from '../i18n/resources';
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
  titleKey: MessageKey;
  messageKey?: MessageKey;
  detail?: string;
  action?: 'open-settings' | 'review-service' | 'retry-translation';
};

export function resolvePopupNotice(
  settings: ExtensionSettings,
  hostPermissionGranted: boolean,
  page: SessionSnapshot | null,
): PopupNotice | null {
  if (!settings.enabled) {
    return {
      kind: 'disabled',
      titleKey: 'popup.notice.disabled.title',
      messageKey: 'popup.notice.disabled.message',
      action: 'open-settings',
    };
  }
  if (
    settings.providerProfiles.length === 0 ||
    !settings.activeProviderProfileId
  ) {
    return {
      kind: 'no-service',
      titleKey: 'popup.notice.noService.title',
      messageKey: 'popup.notice.noService.message',
      action: 'open-settings',
    };
  }
  if (!hostPermissionGranted) {
    return {
      kind: 'no-permission',
      titleKey: 'popup.notice.noPermission.title',
      messageKey: 'popup.notice.noPermission.message',
      action: 'open-settings',
    };
  }
  if (!page) {
    return {
      kind: 'unsupported-page',
      titleKey: 'popup.notice.unsupported.title',
      messageKey: 'popup.notice.unsupported.message',
    };
  }
  if (!page.failure) return null;

  if (page.failure.category === 'quota') {
    return {
      kind: 'quota',
      titleKey: 'popup.notice.quota.title',
      detail: page.failure.message,
      action: 'review-service',
    };
  }
  if (page.failure.category === 'authentication') {
    return {
      kind: 'authentication',
      titleKey: 'popup.notice.authentication.title',
      detail: page.failure.message,
      action: 'review-service',
    };
  }
  if (page.failure.category === 'rate-limit') {
    return {
      kind: 'rate-limit',
      titleKey: 'popup.notice.rateLimit.title',
      detail: page.failure.message,
      action: 'retry-translation',
    };
  }
  return {
    kind: 'translation-error',
    titleKey: 'popup.notice.error.title',
    detail: page.failure.message,
    action: 'retry-translation',
  };
}
