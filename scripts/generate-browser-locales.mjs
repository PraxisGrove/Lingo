import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const locales = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR'];

for (const locale of locales) {
  const source = JSON.parse(
    await readFile(`lib/i18n/resources/${locale}.json`, 'utf8'),
  );
  const directory = path.join('public', '_locales', locale.replace('-', '_'));
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'messages.json'),
    `${JSON.stringify(
      {
        extensionName: { message: 'Lingo' },
        extensionDescription: { message: source['manifest.description'] },
        toggleCommandDescription: { message: source['manifest.toggleCommand'] },
      },
      null,
      2,
    )}\n`,
  );
}
