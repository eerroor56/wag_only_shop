/**
 * Регрессия: глубокие ссылки SPA (/admin/orders/15, /catalog) должны отдавать index.html
 * без sandbox-CSP раздела /uploads — иначе браузер блокирует скрипты и показывает пустой экран.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'wag-static-'));
  for (const app of ['miniapp', 'admin']) {
    await mkdir(path.join(root, app, 'assets'), { recursive: true });
    await writeFile(path.join(root, app, 'index.html'), `<!doctype html><title>${app}</title>`);
    await writeFile(path.join(root, app, 'assets', 'app.js'), `console.log('${app}')`);
  }
  env = await createTestEnv({
    SERVE_STATIC: 'true',
    MINIAPP_DIST: path.join(root, 'miniapp'),
    ADMIN_DIST: path.join(root, 'admin'),
  });
});

afterAll(async () => {
  await env?.close();
  await rm(root, { recursive: true, force: true });
});

describe('Раздача frontend', () => {
  it.each([
    ['/', 'miniapp'],
    ['/catalog', 'miniapp'],
    ['/product/5?from=cart', 'miniapp'],
    ['/admin', 'admin'],
    ['/admin/', 'admin'],
    ['/admin/orders/1002', 'admin'],
    ['/admin/products/new', 'admin'],
  ])('%s → index.html (%s) без sandbox', async (url, app) => {
    const res = await env.app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`<title>${app}</title>`);
    expect(res.headers['content-type']).toContain('text/html');
    expect(String(res.headers['content-security-policy'])).not.toContain('sandbox');
    expect(String(res.headers['content-security-policy'])).toContain("script-src 'self' https://telegram.org");
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('ассеты кешируются надолго, отсутствующие файлы — 404', async () => {
    const asset = await env.app.inject({ method: 'GET', url: '/admin/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    expect((await env.app.inject({ method: 'GET', url: '/assets/missing.js' })).statusCode).toBe(404);
    expect((await env.app.inject({ method: 'GET', url: '/api/unknown' })).statusCode).toBe(404);
  });
});
