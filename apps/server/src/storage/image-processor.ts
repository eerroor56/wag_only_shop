import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { badRequest } from '../lib/errors.js';

/**
 * Безопасная обработка загруженных изображений:
 *  - формат определяется по содержимому (magic bytes), а не по имени файла/заголовку;
 *  - изображение полностью перекодируется в WebP — это удаляет метаданные (EXIF/GPS)
 *    и любые встроенные «полезные нагрузки» (polyglot-файлы);
 *  - ограничено количество пикселей (защита от decompression bomb).
 */

const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'gif', 'heif']);
const MAX_INPUT_PIXELS = 50_000_000;

export interface ProcessedImage {
  key: string;
  thumbKey: string;
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

export async function processProductImage(input: Buffer): Promise<ProcessedImage> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw badRequest('Файл не является изображением');
  }
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) {
    throw badRequest('Поддерживаются JPEG, PNG, WebP, AVIF и GIF');
  }

  const base = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).rotate(); // учесть EXIF-ориентацию
  try {
    const { data: full, info } = await base
      .clone()
      .resize({ width: 1600, height: 2000, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await base
      .clone()
      .resize({ width: 600, height: 800, fit: 'cover', position: 'attention' })
      .webp({ quality: 80 })
      .toBuffer();

    const now = new Date();
    const dir = `products/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const id = randomUUID();
    return {
      key: `${dir}/${id}.webp`,
      thumbKey: `${dir}/${id}_thumb.webp`,
      full,
      thumb,
      width: info.width,
      height: info.height,
    };
  } catch {
    throw badRequest(
      meta.format === 'heif'
        ? 'Формат HEIC не поддерживается. Сохраните фото как JPEG и загрузите снова.'
        : 'Не удалось обработать изображение',
    );
  }
}
