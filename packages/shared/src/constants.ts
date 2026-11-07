/** Общие лимиты бизнес-логики. Используются и на frontend, и на backend. */
export const LIMITS = {
  cartItemMaxQuantity: 99,
  cartMaxPositions: 50,
  productTitleMax: 200,
  productDescriptionMax: 5000,
  productAttributesMax: 20,
  productAttributeNameMax: 60,
  productAttributeValueMax: 200,
  productImagesMax: 15,
  imageMaxBytes: 10 * 1024 * 1024,
  customerNameMax: 100,
  broadcastTextMax: 4096,
  /** Максимальная цена — 100 000 000 ₽ в копейках. */
  priceMax: 100_000_000_00,
} as const;

export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'] as const;
