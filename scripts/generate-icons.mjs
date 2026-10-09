import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { createBrandArchive } from './brand-archive.mjs';

const iconDirectory = fileURLToPath(
  new URL('../public/icon/', import.meta.url),
);
const brandDirectory = fileURLToPath(
  new URL('../public/brand/', import.meta.url),
);
const exportDirectory = fileURLToPath(
  new URL('../docs/brand/assets/', import.meta.url),
);
const masterDirectory = fileURLToPath(
  new URL('../assets/brand/', import.meta.url),
);
const symbol = readFileSync(`${masterDirectory}lingo-symbol.svg`, 'utf8');
const wordmark = readFileSync(`${masterDirectory}lingo-wordmark.svg`, 'utf8');
const inner = (svg) =>
  svg
    .replace(/^\s*<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();
const ink = '#171A17';
const lime = '#DFFF45';
const paper = '#F4F4EF';
const wrap = (body, fill = ink, viewBox = '0 0 128 128') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="${fill}" role="img" aria-label="Lingo">${body}</svg>\n`;
const icon = wrap(
  `<rect width="128" height="128" rx="28" fill="${ink}"/><g fill="${lime}">${inner(symbol)}</g>`,
);
const smallIcon = icon
  .replaceAll('M54 24', 'M58 24')
  .replaceAll('H54V24', 'H58V24');

mkdirSync(iconDirectory, { recursive: true });
mkdirSync(brandDirectory, { recursive: true });
mkdirSync(exportDirectory, { recursive: true });
writeFileSync(`${brandDirectory}lingo-symbol.svg`, symbol);
writeFileSync(`${brandDirectory}lingo-wordmark.svg`, wordmark);
writeFileSync(`${iconDirectory}lingo-mark.svg`, icon);
writeFileSync(`${brandDirectory}lingo-icon.svg`, icon);
writeFileSync(`${brandDirectory}lingo-symbol-ink.svg`, wrap(inner(symbol)));
writeFileSync(
  `${brandDirectory}lingo-symbol-white.svg`,
  wrap(inner(symbol), paper),
);
writeFileSync(
  `${brandDirectory}lingo-symbol-lime.svg`,
  wrap(inner(symbol), lime),
);
for (const [name, color] of [
  ['ink', ink],
  ['white', paper],
]) {
  writeFileSync(
    `${brandDirectory}lingo-wordmark-${name}.svg`,
    wrap(inner(wordmark), color, '0 0 320 128'),
  );
  writeFileSync(
    `${brandDirectory}lingo-logo-${name}.svg`,
    wrap(
      `<g>${inner(symbol)}</g><g transform="translate(148 14) scale(.8)">${inner(wordmark)}</g>`,
      color,
      '0 0 412 128',
    ),
  );
}

const render = (svg, width) =>
  new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
for (const size of [16, 32, 48, 96, 128]) {
  writeFileSync(
    `${iconDirectory}${size}.png`,
    render(size === 16 ? smallIcon : icon, size),
  );
}
for (const size of [256, 512, 1024]) {
  writeFileSync(`${exportDirectory}lingo-icon-${size}.png`, render(icon, size));
}
for (const [name, color] of [
  ['ink', ink],
  ['white', paper],
  ['lime', lime],
]) {
  writeFileSync(
    `${exportDirectory}lingo-symbol-${name}-1024.png`,
    render(wrap(inner(symbol), color), 1024),
  );
  if (name !== 'lime')
    writeFileSync(
      `${exportDirectory}lingo-logo-${name}-1600.png`,
      render(
        readFileSync(`${brandDirectory}lingo-logo-${name}.svg`, 'utf8'),
        1600,
      ),
    );
}
const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['docs/brand/README.md', 'LICENSE'];
for (const directory of [
  'assets/brand',
  'public/brand',
  'public/icon',
  'docs/brand/assets',
]) {
  files.push(
    ...readdirSync(`${root}${directory}`)
      .filter((file) => /\.(svg|png)$/.test(file))
      .map((file) => `${directory}/${file}`),
  );
}
writeFileSync(
  `${exportDirectory}lingo-brand-kit.zip`,
  createBrandArchive(root, files),
);
process.stdout.write(
  'Lingo icons and brand exports generated from the SVG masters.\n',
);
