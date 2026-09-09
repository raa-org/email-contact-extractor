/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

// Bench-only stand-in for the `electron` module. The bench harness loads
// scan-runner -> safe-storage -> `import { safeStorage } from 'electron'`
// even though we never use the keychain (we pass identityCipher through
// runScan deps). Re-export a minimal shape so the import resolves; any
// caller that still reaches into safeStorage at bench-time is a bug we
// want to fail loudly.
export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (_value: string): Buffer => {
    throw new Error('bench: safeStorage.encryptString called — pass identityCipher via deps');
  },
  decryptString: (_blob: Buffer): string => {
    throw new Error('bench: safeStorage.decryptString called — pass identityCipher via deps');
  },
};
