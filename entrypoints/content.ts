import { createLogger } from '@/lib/logger/logger';

export default defineContentScript({
  matches: ['https://example.com/*'],
  main() {
    createLogger('content').info('Content script loaded.');
  },
});
