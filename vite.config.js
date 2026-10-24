import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // Older Android System WebViews must be able to parse the library entry.
  build: { target: 'chrome80' },
  server: { proxy: { '/api': 'http://127.0.0.1:3741', '/media': 'http://127.0.0.1:3741', '/docs': 'http://127.0.0.1:3741' } },
});
