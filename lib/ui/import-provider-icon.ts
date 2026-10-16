import {
  MAX_PROVIDER_ICON_DATA_URL_LENGTH,
  parseProviderIconPreference,
} from '../providers/provider-icon-model';

export type ProviderIconImportErrorCode =
  | 'unsupportedType'
  | 'tooLarge'
  | 'invalidImage'
  | 'storageLimit';

export class ProviderIconImportError extends Error {
  constructor(public readonly code: ProviderIconImportErrorCode) {
    super(code);
    this.name = 'ProviderIconImportError';
  }
}

/** Normalize an explicitly selected local raster image, without retaining metadata. */
export async function importProviderIcon(file: File): Promise<string> {
  if (file.size > 2 * 1024 * 1024)
    throw new ProviderIconImportError('tooLarge');
  if (
    file.type &&
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
  ) {
    throw new ProviderIconImportError('unsupportedType');
  }
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png =
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47;
  const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const webp =
    String.fromCharCode(...header.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
  if (!png && !jpeg && !webp) throw new ProviderIconImportError('invalidImage');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ProviderIconImportError('invalidImage');
  }
  try {
    for (const size of [96, 64]) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context || bitmap.width === 0 || bitmap.height === 0)
        throw new ProviderIconImportError('invalidImage');
      const scale = Math.min(size / bitmap.width, size / bitmap.height);
      const width = bitmap.width * scale;
      const height = bitmap.height * scale;
      context.drawImage(
        bitmap,
        (size - width) / 2,
        (size - height) / 2,
        width,
        height,
      );
      const dataUrl = canvas.toDataURL('image/png');
      if (
        dataUrl.length <= MAX_PROVIDER_ICON_DATA_URL_LENGTH &&
        parseProviderIconPreference({ type: 'image', dataUrl })
      )
        return dataUrl;
    }
    throw new ProviderIconImportError('storageLimit');
  } finally {
    bitmap.close();
  }
}
