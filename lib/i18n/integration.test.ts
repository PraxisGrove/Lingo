import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_UI_LOCALES, toBrowserLocaleDirectory } from './locales';
import { resources } from './resources';

describe('localized product surfaces', () => {
  it('generates complete browser locale messages from every interface locale', async () => {
    for (const locale of SUPPORTED_UI_LOCALES) {
      const file = await readFile(
        `public/_locales/${toBrowserLocaleDirectory(locale)}/messages.json`,
        'utf8',
      );
      const messages = JSON.parse(file);
      expect(messages.extensionName.message).toBe('Lingo');
      expect(messages.extensionDescription.message).toBe(
        resources[locale].translation['manifest.description'],
      );
      expect(messages.toggleCommandDescription.message).toBe(
        resources[locale].translation['manifest.toggleCommand'],
      );
    }
  });

  it('does not leave bare user-facing English in interface source', async () => {
    const files = [
      'entrypoints/popup/App.tsx',
      'entrypoints/options/OptionsApp.tsx',
      'lib/ui/floating-page-control.ts',
      'lib/ui/popup-state.ts',
      'lib/browser/page-actions.ts',
    ];
    const allowed = new Set([
      'Lingo',
      'en, ja',
      'Lingo => Lingo',
      'docs.example.com',
      'API => interface',
      'Promise',
    ]);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const jsxText = [...source.matchAll(/>\s*([A-Za-z][^<{>\n]*?)\s*</g)].map(
        (match) => match[1].trim(),
      );
      const attributes = [
        ...source.matchAll(
          /(?:aria-label|title|placeholder)="([^"]*[A-Za-z][^"]*)"/g,
        ),
      ].map((match) => match[1]);
      expect(
        [...jsxText, ...attributes].filter((text) => !allowed.has(text)),
        file,
      ).toEqual([]);
    }
  });
});
