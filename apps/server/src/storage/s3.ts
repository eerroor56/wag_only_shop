import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { assertSafeKey, type StorageDriver } from './storage.js';

export interface S3Options {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Публичный адрес бакета/CDN, например https://cdn.example.com или https://storage.yandexcloud.net/bucket */
  publicUrl: string;
  forcePathStyle: boolean;
}

/** S3-совместимое хранилище (AWS S3, Yandex Object Storage, Selectel, MinIO, Cloudflare R2 …). */
export class S3Storage implements StorageDriver {
  readonly name = 's3';
  private readonly client: S3Client;

  constructor(private readonly opts: S3Options) {
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }

  publicUrl(key: string): string {
    return `${this.opts.publicUrl}/${key}`;
  }
}
