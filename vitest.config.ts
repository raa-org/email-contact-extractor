/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [
      ['tests/renderer/**', 'jsdom'],
      ['src/renderer/**', 'jsdom'],
      ['**/*', 'node'],
    ],
    setupFiles: ['./tests/renderer/setup.ts'],
    coverage: {
      provider: 'v8',
      // CLAUDE.md §7: classifier ≥80%, pipeline ≥80%. We track both
      // here; classifier in practice runs above 90% so the global
      // thresholds reflect the pipeline floor.
      include: ['src/main/classifier/**/*.ts', 'src/main/pipeline/**/*.ts'],
      reporter: ['text', 'text-summary'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
