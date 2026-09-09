/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import { deriveMyAddresses } from '../../../src/main/classifier/derive-my-addresses.js';
import type { ParsedHeaders } from '../../../src/main/imap/headers.js';

function H(from: string | null, overrides: Partial<ParsedHeaders> = {}): ParsedHeaders {
  return {
    from: from ? { email: from } : null,
    to: [],
    cc: [],
    date: null,
    subject: null,
    messageId: null,
    inReplyTo: null,
    references: [],
    autoSubmitted: null,
    precedence: null,
    listUnsubscribe: null,
    listId: null,
    hasListUnsubscribe: false,
    hasListId: false,
    hasInlineUnsubscribe: false,
    ...overrides,
  };
}

describe('deriveMyAddresses', () => {
  it('falls back to login when no Sent headers are provided', () => {
    const set = deriveMyAddresses({
      loginAddress: 'Me@example.com',
      sentHeaders: [],
    });
    expect(set).toEqual(new Set(['me@example.com']));
  });

  it('collects unique From addresses from Sent headers', () => {
    const set = deriveMyAddresses({
      loginAddress: 'me@example.com',
      sentHeaders: [
        H('me@example.com'),
        H('me.alt@example.com'),
        H('me@example.com'), // duplicate
        H(null), // skipped
      ],
    });
    expect(set).toEqual(new Set(['me@example.com', 'me.alt@example.com']));
  });

  it('keeps gmail +tag / dot variants as distinct entries (no alias-collapsing)', () => {
    // We dropped Gmail-specific aliasing in normalizeEmail; the
    // user's own +tag/dot variants now appear as separate addresses.
    // myAddresses still does the right thing for the dominant form
    // (the login address) — and aliases the user actually uses will
    // be picked up via the From column from Sent.
    const set = deriveMyAddresses({
      loginAddress: 'al.ice+work@gmail.com',
      sentHeaders: [H('alice+other@gmail.com')],
    });
    expect(set).toEqual(
      new Set(['al.ice+work@gmail.com', 'alice+other@gmail.com']),
    );
  });

  it('includes the login address even if Sent contains different ones', () => {
    const set = deriveMyAddresses({
      loginAddress: 'me@example.com',
      sentHeaders: [H('persona@example.com')],
    });
    expect(set.has('me@example.com')).toBe(true);
    expect(set.has('persona@example.com')).toBe(true);
  });

  it('handles whitespace and case in login address', () => {
    const set = deriveMyAddresses({
      loginAddress: '  USER@Example.COM ',
      sentHeaders: [],
    });
    expect(set).toEqual(new Set(['user@example.com']));
  });
});
