/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      rollupOptions: {
        // Two entries land in `out/main/` side by side:
        //   • index.js — Electron main process entry (IPC handlers,
        //     app lifecycle, DB).
        //   • parser-worker.js — separate worker bundle started by the
        //     parser pool via `new Worker(…/parser-worker.js)`. Kept as
        //     its own entry so mailparser + deps code-split out of the
        //     main bundle, and so the worker boots without pulling in
        //     anything Electron-specific.
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'parser-worker': resolve(
            __dirname,
            'src/main/pipeline/workers/parser-worker.ts',
          ),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});
