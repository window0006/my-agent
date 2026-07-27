import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  // Persist dep-prebundle + transform cache between builds so subsequent
  // builds skip the 3000+ module transform step.
  cacheDir: '../../node_modules/.vite/web',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});