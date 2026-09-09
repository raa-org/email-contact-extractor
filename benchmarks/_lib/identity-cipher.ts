/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { CredentialCipher } from '../../src/main/security/safe-storage.js';

// Bench-only cipher that round-trips plaintext through Buffer without
// touching the OS keychain. Lets the bench harness exercise the body
// cache code path (upsertMessageBody / getMessageBodyDecrypted) without
// requiring an Electron runtime. Bench data is throwaway, so storing
// "unencrypted" blobs in a temp SQLite file is fine.
export const identityCipher: CredentialCipher = {
  isAvailable: () => true,
  encrypt: (plaintext: string): Buffer => Buffer.from(plaintext, 'utf8'),
  decrypt: (blob: Buffer): string => blob.toString('utf8'),
};
