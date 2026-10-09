import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true as any,
    hmr: { clientPort: 443, protocol: 'wss' } as any,
  },
  preview: { host: '0.0.0.0', allowedHosts: true as any },
  build: { target: 'es2020', chunkSizeWarningLimit: 2400 },
});
