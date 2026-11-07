import type { AdminImageDTO, ImageDTO } from '@wag/shared';
import type { ProductImage } from '../../db/schema.js';
import type { StorageDriver } from '../../storage/index.js';

export function toImageDTO(img: ProductImage, storage: StorageDriver): ImageDTO {
  return {
    id: img.id,
    url: storage.publicUrl(img.storageKey),
    thumbUrl: storage.publicUrl(img.thumbKey),
    width: img.width,
    height: img.height,
  };
}

export function toAdminImageDTO(img: ProductImage, storage: StorageDriver): AdminImageDTO {
  return { ...toImageDTO(img, storage), isMain: img.isMain };
}

/** Порядок по sort_order. */
export function sortImages(images: ProductImage[]): ProductImage[] {
  return [...images].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

/** Главное фото: помеченное is_main, иначе первое по порядку. */
export function mainImage(images: ProductImage[]): ProductImage | undefined {
  return images.find((i) => i.isMain) ?? sortImages(images)[0];
}

/** Галерея для покупателя: главное фото первым, остальные — в порядке администратора. */
export function galleryOrder(images: ProductImage[]): ProductImage[] {
  const sorted = sortImages(images);
  const main = mainImage(sorted);
  return main ? [main, ...sorted.filter((i) => i.id !== main.id)] : sorted;
}
