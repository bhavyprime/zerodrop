import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development the API and WebSocket live on the Express server (port 4000).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: { environment: 'jsdom', globals: true, css: false },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
});
