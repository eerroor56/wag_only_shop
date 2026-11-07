// Production-сборка сервера: один ESM-бандл на точку входа.
// Workspace-пакет @wag/shared (TypeScript) встраивается в бандл, npm-зависимости остаются внешними.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@wag/'));

await build({
  entryPoints: {
    index: 'src/index.ts',
    migrate: 'src/db/migrate-cli.ts',
    seed: 'src/db/seed.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  // зависимости @wag/shared тоже должны быть внешними
  external: [...external, 'zod', 'libphonenumber-js', 'pino-pretty'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
