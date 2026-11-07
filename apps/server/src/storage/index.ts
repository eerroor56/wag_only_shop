import type { AppConfig } from '../config.js';
import { LocalStorage } from './local.js';
import type { StorageDriver } from './storage.js';

export type { StorageDriver } from './storage.js';

export async function createStorage(config: AppConfig['storage']): Promise<StorageDriver> {
  if (config.driver === 's3' && config.s3) {
    // Загружаем AWS SDK только когда он действительно нужен.
    const { S3Storage } = await import('./s3.js');
    return new S3Storage(config.s3);
  }
  return new LocalStorage(config.uploadDir);
}
