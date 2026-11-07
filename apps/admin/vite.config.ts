import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const backend = process.env.VITE_BACKEND_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  server: {
    port: 5174,
    host: true,
    // Для тестирования внутри Telegram через HTTPS-туннель (cloudflared, ngrok)
    allowedHosts: true,
    proxy: {
      '/api': backend,
      '/uploads': backend,
    },
  },
  build: {
    target: ['es2020', 'safari14'],
    sourcemap: false,
    // Админка открывается редко и только администраторами — один чанк проще кешировать.
    chunkSizeWarningLimit: 900,
  },
});
