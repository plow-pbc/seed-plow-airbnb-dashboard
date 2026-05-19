import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    define: {
      __NEXT_N__: JSON.stringify(env.NEXT_N || '12'),
      __REFRESH_MS__: JSON.stringify(env.REFRESH_MS || '300000'),
    },
    server: {
      port: 5173,
      proxy: {
        '/api': `http://localhost:${env.PORT || '5174'}`,
      },
    },
  };
});
