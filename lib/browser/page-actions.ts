import type {
  SessionPatch,
  SessionSnapshot,
  StartSessionOptions,
} from '../page-translation/page-translation';

export type PageAction = 'toggle' | 'translate' | 'translate-all' | 'restore';

type PageActionDependencies = {
  getActiveTabId(): Promise<number | undefined>;
  getTargetLanguage(): Promise<string>;
  getSnapshot(tabId: number): Promise<SessionSnapshot>;
  start(tabId: number, options: StartSessionOptions): Promise<unknown>;
  update(tabId: number, patch: SessionPatch): Promise<unknown>;
  stop(tabId: number): Promise<unknown>;
};

export const PAGE_CONTEXT_MENUS = [
  {
    id: 'lingo-translate-page',
    title: 'Translate page with Lingo',
    action: 'translate',
  },
  {
    id: 'lingo-translate-all',
    title: 'Translate entire page with Lingo',
    action: 'translate-all',
  },
  {
    id: 'lingo-restore-original',
    title: 'Restore original page',
    action: 'restore',
  },
] as const;

export function createPageActions(dependencies: PageActionDependencies) {
  async function start(tabId: number, translateImmediately: boolean) {
    return dependencies.start(tabId, {
      targetLanguage: await dependencies.getTargetLanguage(),
      displayMode: 'bilingual',
      translateImmediately,
    });
  }

  return {
    async run(action: PageAction, requestedTabId?: number): Promise<void> {
      const tabId = requestedTabId ?? (await dependencies.getActiveTabId());
      if (tabId === undefined) return;
      if (action === 'translate') {
        await start(tabId, false);
        return;
      }
      if (action === 'restore') {
        await dependencies.stop(tabId);
        return;
      }
      const snapshot = await dependencies.getSnapshot(tabId);
      if (action === 'toggle') {
        if (snapshot.status === 'idle') await start(tabId, false);
        else await dependencies.stop(tabId);
        return;
      }
      if (snapshot.status === 'idle') await start(tabId, true);
      else {
        await dependencies.update(tabId, {
          displayMode: snapshot.displayMode,
          translateImmediately: true,
        });
      }
    },
  };
}
