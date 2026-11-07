import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const backend = process.env.VITE_BACKEND_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    port: 5173,
    host: true,
    // Для тестирования внутри Telegram через HTTPS-туннель (cloudflared, ngrok)
    allowedHosts: true,
    proxy: {
      '/api': backend,
      '/uploads': backend,
      // Админка в dev обслуживается отдельным Vite (порт 5174) — проксируем, чтобы переход /admin/ работал как в production.
      '/admin': { target: process.env.VITE_ADMIN_DEV_URL ?? 'http://localhost:5174', ws: true },
    },
  },
  build: {
    target: ['es2020', 'safari14'],
    sourcemap: false,
  },
});
