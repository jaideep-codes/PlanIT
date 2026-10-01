import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required because Nest's dependency injection relies on decorator metadata,
// which the default Vite transform does not emit.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
