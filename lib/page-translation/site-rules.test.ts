// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  SITE_LAYOUTS,
  SITE_PARAGRAPH,
} from '../../tests/fixtures/site-layouts';
import { BUILT_IN_RULES, resolveRules } from '../rules/rule-resolver';
import { createPageTranslation } from './page-translation';

describe('site rules applied to page translation', () => {
  it.each(
    SITE_LAYOUTS,
  )('extracts only reading content on $hostname layouts', async ({
    hostname,
    html,
  }) => {
    document.body.innerHTML = html;
    const requests: string[] = [];
    const session = createPageTranslation({
      document,
      getRuleSelectors: async () =>
        resolveRules({ hostname, builtIn: BUILT_IN_RULES }).selectors,
      async translate(units) {
        requests.push(...units.map((unit) => unit.text));
        return units;
      },
    });
    try {
      await session.start({
        targetLanguage: 'zh-CN',
        displayMode: 'bilingual',
      });
      expect(requests).toEqual([SITE_PARAGRAPH]);
    } finally {
      await session.stop();
    }
    expect(document.body.innerHTML).toBe(html);
  });

  it('honors user main, interface, and exclusion selectors over built-in selectors', async () => {
    document.body.innerHTML =
      '<main><p>Built-in content.</p></main><section id="reading"><p>User content.</p><aside class="private"><p>Private text.</p></aside></section><div class="controls"><p>Interface label.</p></div>';
    const requests: string[] = [];
    const session = createPageTranslation({
      document,
      getRuleSelectors: async () =>
        resolveRules({
          hostname: 'react.dev',
          builtIn: BUILT_IN_RULES,
          user: {
            schemaVersion: 1,
            rules: [
              {
                id: 'user-scope',
                domain: 'react.dev',
                selectors: {
                  main: ['#reading'],
                  interface: ['.controls'],
                  exclude: ['.private'],
                },
              },
            ],
          },
        }).selectors,
      async translate(units) {
        requests.push(...units.map((unit) => unit.text));
        return units;
      },
    });
    try {
      await session.start({
        targetLanguage: 'zh-CN',
        displayMode: 'bilingual',
        contentScope: 'main-and-interface',
      });
      expect(requests.sort()).toEqual(['Interface label.', 'User content.']);
    } finally {
      await session.stop();
    }
  });

  it('fails without sending content when a selector is invalid', async () => {
    let requested = false;
    const session = createPageTranslation({
      document,
      getRuleSelectors: async () => ({ main: ['['] }),
      translate: async () => {
        requested = true;
        return [];
      },
    });
    try {
      expect(
        await session.start({
          targetLanguage: 'zh-CN',
          displayMode: 'bilingual',
        }),
      ).toMatchObject({ status: 'failed' });
      expect(requested).toBe(false);
    } finally {
      await session.stop();
    }
  });
});
