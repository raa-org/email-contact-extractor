/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import {
  AuthError,
  CancelledError,
  FolderNotFoundError,
  NetworkError,
  isImapError,
} from '../../../src/main/imap/errors.js';

describe('imap errors', () => {
  it('uses tag as discriminator', () => {
    expect(new AuthError('x').tag).toBe('AuthError');
    expect(new NetworkError('x').tag).toBe('NetworkError');
    expect(new FolderNotFoundError('INBOX').tag).toBe('FolderNotFoundError');
    expect(new CancelledError().tag).toBe('CancelledError');
  });

  it('FolderNotFoundError carries the path', () => {
    const e = new FolderNotFoundError('Shared/Team');
    expect(e.folderPath).toBe('Shared/Team');
    expect(e.message).toContain('Shared/Team');
  });

  it('isImapError accepts our typed errors and rejects plain Error', () => {
    expect(isImapError(new AuthError('x'))).toBe(true);
    expect(isImapError(new NetworkError('x'))).toBe(true);
    expect(isImapError(new FolderNotFoundError('x'))).toBe(true);
    expect(isImapError(new CancelledError())).toBe(true);
    expect(isImapError(new Error('x'))).toBe(false);
    expect(isImapError(null)).toBe(false);
  });
});
