import {
  BUILT_IN_MESSAGE_TARGET,
  type BuiltInRequest,
  type BuiltInResponse,
  createOffscreenBuiltInEngine,
} from './built-in-provider';

const OFFSCREEN_PATH = '/offscreen.html';

let creating: Promise<void> | undefined;

async function ensureOffscreenDocument() {
  const contexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [browser.runtime.getURL(OFFSCREEN_PATH)],
  });
  if (contexts.length > 0) return;
  creating ??= browser.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['DOM_PARSER'],
      justification:
        'Run the browser on-device Translator API, which is unavailable in service workers.',
    })
    .finally(() => {
      creating = undefined;
    });
  await creating;
}

export function createOffscreenEngine() {
  return createOffscreenBuiltInEngine(async (request: BuiltInRequest) => {
    await ensureOffscreenDocument();
    return (await browser.runtime.sendMessage({
      target: BUILT_IN_MESSAGE_TARGET,
      request,
    })) as BuiltInResponse | undefined;
  });
}
