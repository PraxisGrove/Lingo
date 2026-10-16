import { describe, expect, it } from 'vitest';
import {
  MAX_PROVIDER_ICON_DATA_URL_LENGTH,
  parseProviderIconPreference,
} from '../../lib/providers/provider-icon-model';
import { importProviderIcon } from '../../lib/ui/import-provider-icon';

describe('local provider icon import', () => {
  it.each([
    'image/png',
    'image/jpeg',
  ])('keeps a %s logo proportionate and produces a bounded local PNG', async (mime) => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 80;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable.');
    context.fillStyle = '#1464ff';
    context.fillRect(0, 0, 200, 80);
    const file = await canvasFile(canvas, mime);
    const dataUrl = await importProviderIcon(file);
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(dataUrl.length).toBeLessThanOrEqual(
      MAX_PROVIDER_ICON_DATA_URL_LENGTH,
    );
    expect(
      parseProviderIconPreference({ type: 'image', dataUrl }),
    ).toBeDefined();
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    expect(bitmap.width).toBeLessThanOrEqual(96);
    expect(bitmap.height).toBe(bitmap.width);
    const output = document.createElement('canvas');
    output.width = bitmap.width;
    output.height = bitmap.height;
    const pixels = output.getContext('2d');
    if (!pixels) throw new Error('Canvas unavailable.');
    pixels.drawImage(bitmap, 0, 0);
    expect(pixels.getImageData(0, 0, 1, 1).data[3]).toBe(0);
    expect(
      pixels.getImageData(bitmap.width / 2, bitmap.height / 2, 1, 1).data[3],
    ).toBe(255);
    bitmap.close();
  });

  it('rejects vector, oversized and corrupt images without importing them', async () => {
    await expect(
      importProviderIcon(
        new File(['<svg/>'], 'icon.svg', { type: 'image/svg+xml' }),
      ),
    ).rejects.toMatchObject({ code: 'unsupportedType' });
    await expect(
      importProviderIcon(
        new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', {
          type: 'image/png',
        }),
      ),
    ).rejects.toMatchObject({ code: 'tooLarge' });
    await expect(
      importProviderIcon(
        new File(
          [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])],
          'broken.png',
          { type: 'image/png' },
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalidImage' });
  });
});

async function canvasFile(
  canvas: HTMLCanvasElement,
  mime: string,
): Promise<File> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error('Image unavailable.')),
      mime,
    ),
  );
  return new File([blob], 'icon', { type: mime });
}
