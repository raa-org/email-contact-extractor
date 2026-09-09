/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

// Wrapper around Electron's `safeStorage` so call sites stay testable and the
// electron import is contained. safeStorage encrypts via the OS keychain
// (Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux). On a
// fresh user session encryption may briefly be unavailable — callers must
// degrade gracefully (do not save creds) rather than throwing.

import { safeStorage } from 'electron';

export class CredentialEncryptionUnavailableError extends Error {
  constructor() {
    super('Credential encryption is unavailable on this system');
    this.name = 'CredentialEncryptionUnavailableError';
  }
}

export interface CredentialCipher {
  isAvailable(): boolean;
  encrypt(plaintext: string): Buffer;
  decrypt(blob: Buffer): string;
}

export const electronSafeStorageCipher: CredentialCipher = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plaintext: string): Buffer => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new CredentialEncryptionUnavailableError();
    }
    return safeStorage.encryptString(plaintext);
  },
  decrypt: (blob: Buffer): string => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new CredentialEncryptionUnavailableError();
    }
    return safeStorage.decryptString(blob);
  },
};
