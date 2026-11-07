import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { SERVER_ROOT } from '../config.js';
import type { Database } from './client.js';

export const MIGRATIONS_DIR = path.join(SERVER_ROOT, 'drizzle');

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
