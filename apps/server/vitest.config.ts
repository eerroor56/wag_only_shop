import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Интеграционные тесты используют одну тестовую БД — выполняем последовательно.
    fileParallelism: false,
  },
});
