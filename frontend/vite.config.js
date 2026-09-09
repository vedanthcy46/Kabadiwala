import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget = env.VITE_DEV_SERVER_BACKEND || 'http://localhost:3000';

  return {
    plugins: [react()],
    server: {
      port: env.VITE_PORT ? Number(env.VITE_PORT) : 5173,
      proxy: {
        '/v1': {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
