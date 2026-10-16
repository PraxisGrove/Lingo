import { useState } from 'react';
import { useInterfaceTranslation } from '@/lib/i18n/i18n';
import { createLogger } from '@/lib/logger/logger';
import { sendMessage } from '@/lib/messaging/send-message';
import {
  hasBuiltInTranslator,
  prepareBuiltInTranslation,
} from '@/lib/providers/built-in-translator';
import {
  type ExtensionSettings,
  type ProviderProfile,
  setSettings,
} from '@/lib/storage/settings';
import { ProviderIcon } from '@/lib/ui/provider-icon';
import { SettingsIcon } from '@/lib/ui/settings-icon';

const logger = createLogger('on-device-setup');

type Status = 'idle' | 'preparing' | 'ready' | 'unsupported' | 'failed';

const INITIAL_SOURCE_LANGUAGES = ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de'];
const MORE_SOURCE_LANGUAGES = [
  'en',
  'zh',
  'zh-Hant',
  'ja',
  'ko',
  'es',
  'fr',
  'de',
  'pt',
  'ru',
  'it',
  'ar',
  'hi',
  'vi',
  'th',
  'id',
  'tr',
  'pl',
  'nl',
  'uk',
];

export default function OnDeviceSetup({
  settings,
  onSettingsChange,
  onConnected,
}: {
  settings: ExtensionSettings;
  onSettingsChange(next: ExtensionSettings): void;
  onConnected(): void;
}) {
  const { t } = useInterfaceTranslation();
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const configured = settings.providerProfiles.some(
    (profile) => profile.provider === 'built-in',
  );
  if (!hasBuiltInTranslator()) return null;

  async function enable() {
    if (status === 'preparing') return;
    setStatus('preparing');
    setProgress(0);
    try {
      // Model downloads only start from a user gesture in a visible page.
      const { ready } = await prepareBuiltInTranslation(
        settings.targetLanguage,
        {
          sourceLanguages: configured
            ? MORE_SOURCE_LANGUAGES
            : INITIAL_SOURCE_LANGUAGES,
          onProgress: setProgress,
        },
      );
      if (ready.length === 0) {
        setStatus('unsupported');
        return;
      }
      if (configured) {
        setStatus('ready');
        return;
      }
      const profile: ProviderProfile = {
        id: crypto.randomUUID(),
        name: t('onDevice.name'),
        provider: 'built-in',
      };
      await sendMessage('saveProviderProfile', { profile, credential: '' });
      onSettingsChange(await setSettings({ setupCompleted: true }));
      setStatus('idle');
      onConnected();
    } catch (error) {
      logger.warn('Could not prepare on-device translation.', { error });
      setStatus('failed');
    }
  }

  return (
    <section className="on-device-setup" aria-labelledby="on-device-heading">
      <span className="model-provider-mark" aria-hidden="true">
        <ProviderIcon presetId="built-in" size={22} />
      </span>
      <div>
        <h3 id="on-device-heading">{t('onDevice.title')}</h3>
        <p>
          {t(configured ? 'onDevice.packsDescription' : 'onDevice.description')}
        </p>
        {status === 'ready' && <p role="status">{t('onDevice.packsReady')}</p>}
        {status === 'preparing' && (
          <p role="status">
            {t('onDevice.preparing', { percent: Math.round(progress * 100) })}
          </p>
        )}
        {status === 'unsupported' && (
          <p role="alert">{t('onDevice.unsupported')}</p>
        )}
        {status === 'failed' && <p role="alert">{t('onDevice.failed')}</p>}
      </div>
      <button
        className="primary-button"
        type="button"
        disabled={status === 'preparing'}
        onClick={() => void enable()}
      >
        <SettingsIcon name="check" size={16} />
        {t(configured ? 'onDevice.downloadPacks' : 'onDevice.enable')}
      </button>
    </section>
  );
}
