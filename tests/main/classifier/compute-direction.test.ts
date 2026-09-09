/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import { computeDirection } from '../../../src/main/classifier/compute-direction.js';
import type { ParsedHeaders } from '../../../src/main/imap/headers.js';

function H(overrides: Partial<ParsedHeaders>): ParsedHeaders {
  return {
    from: null,
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

const myAddrs = new Set(['me@example.com', 'me.alt@example.com']);

describe('computeDirection', () => {
  it("returns 'in' when From is empty", () => {
    expect(computeDirection(H({}), myAddrs)).toBe('in');
  });

  it("returns 'in' when From is external", () => {
    const h = H({
      from: { email: 'sender@external.com' },
      to: [{ email: 'me@example.com' }],
    });
    expect(computeDirection(h, myAddrs)).toBe('in');
  });

  it("returns 'out' when From is mine and recipient is external", () => {
    const h = H({
      from: { email: 'me@example.com' },
      to: [{ email: 'partner@external.com' }],
    });
    expect(computeDirection(h, myAddrs)).toBe('out');
  });

  it("returns 'out' from secondary user address", () => {
    const h = H({
      from: { email: 'Me.ALT@example.com' },
      to: [{ email: 'partner@external.com' }],
    });
    expect(computeDirection(h, myAddrs)).toBe('out');
  });

  it("returns 'self' only when EVERY recipient is the user (note-to-self)", () => {
    const h = H({
      from: { email: 'me@example.com' },
      to: [{ email: 'me.alt@example.com' }],
    });
    expect(computeDirection(h, myAddrs)).toBe('self');
  });

  it("returns 'self' when several user-aliases are the only recipients", () => {
    const h = H({
      from: { email: 'me@example.com' },
      to: [{ email: 'me.alt@example.com' }, { email: 'me@example.com' }],
    });
    expect(computeDirection(h, myAddrs)).toBe('self');
  });

  it("returns 'out' when self is just one of multiple recipients (group email)", () => {
    // Common pattern: send to a partner and copy yourself for archive. The
    // partner MUST still be credited with countOut, so this can't be 'self'.
    const h = H({
      from: { email: 'me@example.com' },
      to: [{ email: 'partner@x.com' }, { email: 'me@example.com' }],
    });
    expect(computeDirection(h, myAddrs)).toBe('out');
  });

  it("returns 'out' when self is in Cc but To is external (cc-self-for-archive)", () => {
    const h = H({
      from: { email: 'me@example.com' },
      to: [{ email: 'partner@x.com' }],
      cc: [{ email: 'me.alt@example.com' }],
    });
    expect(computeDirection(h, myAddrs)).toBe('out');
  });

  it("returns 'out' for a group email with multiple external recipients and self cc'd", () => {
    const h = H({
      from: { email: 'me@example.com' },
      to: [{ email: 'a@x.com' }, { email: 'b@y.com' }, { email: 'c@z.com' }],
      cc: [{ email: 'me@example.com' }],
    });
    expect(computeDirection(h, myAddrs)).toBe('out');
  });

  it("returns 'out' when From is mine and there are no recipients (degenerate)", () => {
    const h = H({ from: { email: 'me@example.com' } });
    expect(computeDirection(h, myAddrs)).toBe('out');
  });

  it("does NOT alias gmail +tag / dot variants — they're treated as distinct mailboxes", () => {
    // Normalisation is just trim+lowercase now (see email-normalize.ts);
    // we no longer strip dots or +tag from gmail addresses, so a sender
    // using `me+work@gmail.com` does not match `me@gmail.com` even
    // though Gmail itself routes both to the same inbox. The trade-off
    // is documented: address fidelity wins over alias-collapsing.
    const myGmail = new Set(['me@gmail.com']);
    const h = H({
      from: { email: 'me+work@gmail.com' },
      to: [{ email: 'partner@x.com' }],
    });
    expect(computeDirection(h, myGmail)).toBe('in');
  });
});
