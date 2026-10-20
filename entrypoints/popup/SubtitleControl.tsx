import { useEffect, useState } from 'react';
import { useInterfaceTranslation } from '@/lib/i18n/i18n';
import { createLogger } from '@/lib/logger/logger';
import { createMessage } from '@/lib/messaging/messages';
import type { SubtitleSnapshot } from '@/lib/subtitles/controller';
import {
  getSubtitlePreferences,
  updateSubtitlePreferences,
} from '@/lib/subtitles/subtitle-store';

const logger = createLogger('popup-subtitles');

type FrameState = { frameId: number; snapshot: SubtitleSnapshot };

/** Videos often play inside frames, so ask every frame of the tab. */
async function videoFrame(tabId: number): Promise<FrameState | undefined> {
  const frames = (await browser.webNavigation
    .getAllFrames({ tabId })
    .catch(() => null)) ?? [{ frameId: 0 }];
  const states = await Promise.all(
    frames.map(async ({ frameId }) => {
      try {
        const snapshot = (await browser.tabs.sendMessage(
          tabId,
          createMessage('getSubtitleState', {}),
          { frameId },
        )) as SubtitleSnapshot | undefined;
        return snapshot?.hasVideo || snapshot?.active
          ? { frameId, snapshot }
          : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  const found = states.filter((state): state is FrameState => Boolean(state));
  return found.find((state) => state.snapshot.active) ?? found[0];
}

export default function SubtitleControl({
  hostname,
  serviceName,
}: {
  hostname: string;
  serviceName?: string;
}) {
  const { t } = useInterfaceTranslation();
  const [tabId, setTabId] = useState<number>();
  const [frame, setFrame] = useState<FrameState>();
  const [autoStart, setAutoStart] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function poll() {
      try {
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab?.id === undefined || cancelled) return;
        setTabId(tab.id);
        const next = await videoFrame(tab.id);
        if (!cancelled) setFrame(next);
      } catch (error) {
        logger.debug('Could not read subtitle state.', { error });
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 1500);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    void getSubtitlePreferences().then((preferences) =>
      setAutoStart(preferences.autoStartHosts.includes(hostname)),
    );
  }, [hostname]);

  if (!frame || tabId === undefined) return null;
  const { snapshot } = frame;

  async function toggle() {
    if (busy || tabId === undefined || !frame) return;
    setBusy(true);
    try {
      const next = (await browser.tabs.sendMessage(
        tabId,
        createMessage(snapshot.active ? 'stopSubtitles' : 'startSubtitles', {}),
        { frameId: frame.frameId },
      )) as SubtitleSnapshot;
      setFrame({ ...frame, snapshot: next });
    } catch (error) {
      logger.warn('Could not change subtitle translation.', { error });
    } finally {
      setBusy(false);
    }
  }

  async function changeAutoStart(enabled: boolean) {
    setAutoStart(enabled);
    await updateSubtitlePreferences((current) => ({
      autoStartHosts: enabled
        ? [...current.autoStartHosts, hostname]
        : current.autoStartHosts.filter((host) => host !== hostname),
    }));
  }

  const detail =
    snapshot.status === 'waiting-captions'
      ? t(
          snapshot.missingCaptionsHint === 'signIn'
            ? 'subtitles.status.signIn'
            : 'subtitles.status.waiting',
        )
      : snapshot.status === 'failed'
        ? t('subtitles.status.failed')
        : snapshot.source === 'live'
          ? t('popup.subtitles.live')
          : t('popup.subtitles.privacy', {
              service: serviceName ?? '',
            });

  return (
    <section
      className="subtitle-control"
      aria-label={t('popup.subtitles.title')}
    >
      <div className="subtitle-row">
        <span>
          <strong>{t('popup.subtitles.title')}</strong>
          <small role="status">{detail}</small>
        </span>
        <button
          type="button"
          className={snapshot.active ? 'secondary-pill' : 'primary-pill'}
          aria-pressed={snapshot.active}
          disabled={busy}
          onClick={() => void toggle()}
        >
          {t(
            snapshot.active ? 'popup.subtitles.stop' : 'popup.subtitles.start',
          )}
        </button>
      </div>
      {hostname && (
        <label className="toggle-option subtitle-auto">
          <span>{t('popup.subtitles.autoStart')}</span>
          <input
            type="checkbox"
            checked={autoStart}
            onChange={(event) =>
              void changeAutoStart(event.currentTarget.checked)
            }
          />
          <span className="toggle-track" aria-hidden="true" />
        </label>
      )}
    </section>
  );
}
