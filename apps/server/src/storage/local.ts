import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertSafeKey, type StorageDriver } from './storage.js';

/** Локальный диск. Файлы раздаются сервером по /uploads/* как статика (без исполнения). */
export class LocalStorage implements StorageDriver {
  readonly name = 'local';

  constructor(
    private readonly rootDir: string,
    private readonly publicBase = '/uploads',
  ) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.rootDir, key);
    if (!full.startsWith(path.resolve(this.rootDir) + path.sep)) throw new Error('Path traversal');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { mode: 0o644 });
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  publicUrl(key: string): string {
    return `${this.publicBase}/${key}`;
  }
}
