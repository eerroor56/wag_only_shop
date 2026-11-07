/**
 * Абстракция хранилища файлов. Сервисы работают только с ключами (например "products/2026/11/uuid.webp"),
 * а публичный URL строится драйвером. Это позволяет сменить локальный диск на S3 без изменения БД.
 */
export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}

/** Ключи генерируются только сервером, но дополнительно защищаемся от path traversal. */
export function assertSafeKey(key: string): void {
  if (!/^[a-z0-9][a-z0-9/_-]*\.[a-z0-9]{2,5}$/.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}
