/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Separate vitest config for benchmark runs. Diverges from the unit-test
// config in three ways:
//   • include = benchmarks/**/*.bench.ts (units never run here)
//   • environment = node (no jsdom — bench is pipeline + DB only)
//   • testTimeout pumped to 30 min so a 100k mailbox e2e run finishes
//   • alias `electron` → an in-process stub so safe-storage.ts can be
//     imported without an Electron runtime; bench callers pass
//     identityCipher via runScan deps so safeStorage.* is never called
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      electron: resolve(__dirname, 'benchmarks/_lib/electron-stub.ts'),
    },
  },
  test: {
    include: ['benchmarks/**/*.bench.ts'],
    environment: 'node',
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 60 * 1000,
    bail: 1,
    // Default vitest runs a worker pool for parallelism. Bench output is
    // disk-backed JSONL — keeping it serial avoids interleaved writes and
    // makes performance.now() deltas comparable across runs.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    reporters: ['default'],
  },
});
