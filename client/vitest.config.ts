import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Same swap as vite.config.ts: jassub's GPL-3.0 rvfc-polyfill becomes an empty module.
      { find: /^rvfc-polyfill(?=$|\?)/, replacement: path.resolve(__dirname, 'src/lib/vendor/rvfcPolyfillStub.ts') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(__dirname, 'src/test-setup.ts')],
  },
});
