import {
  BUILT_IN_MESSAGE_TARGET,
  type BuiltInRequest,
  serveBuiltInRequests,
} from '@/lib/providers/built-in-provider';
import {
  browserBuiltInApis,
  createBuiltInTranslationEngine,
} from '@/lib/providers/built-in-translator';

const serve = serveBuiltInRequests(
  createBuiltInTranslationEngine(browserBuiltInApis()),
);

browser.runtime.onMessage.addListener((message) => {
  if (
    typeof message !== 'object' ||
    message === null ||
    message.target !== BUILT_IN_MESSAGE_TARGET
  )
    return undefined;
  return serve(message.request as BuiltInRequest);
});
