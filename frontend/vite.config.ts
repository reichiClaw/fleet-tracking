import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Local dev convenience: proxy API/admin/media calls to the Django backend so
// `npm run dev` works against the default same-origin VITE_API_BASE_URL=/api/v1
// without enabling CORS or pointing the frontend at a full backend URL.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const backendTarget = env.DEV_BACKEND_URL ?? 'http://localhost:8000';

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': { target: backendTarget, changeOrigin: true },
        '/admin': { target: backendTarget, changeOrigin: true },
        '/media': { target: backendTarget, changeOrigin: true },
        '/static': { target: backendTarget, changeOrigin: true },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.ts',
    },
  };
});
