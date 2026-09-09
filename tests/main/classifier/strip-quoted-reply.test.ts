/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import { stripQuotedReply } from '../../../src/main/classifier/strip-quoted-reply.js';

describe('stripQuotedReply', () => {
  it('returns body unchanged when no reply markers present', () => {
    expect(stripQuotedReply('Hello, just checking in. — Jane')).toBe(
      'Hello, just checking in. — Jane',
    );
  });

  it('cuts at the Apple/Gmail-style "On … wrote:" attribution', () => {
    const body =
      'Confirmed, see you Friday.\n\nOn Mon, Jan 1, 2024 at 10:30 AM Jane <jane@acme.com> wrote:\n> Friday at 3 still good?';
    expect(stripQuotedReply(body)).toBe('Confirmed, see you Friday.');
  });

  it('cuts at Outlook "-----Original Message-----" divider', () => {
    const body = 'Sure thing.\n-----Original Message-----\nFrom: Jane';
    expect(stripQuotedReply(body)).toBe('Sure thing.');
  });

  it('cuts at the first quoted line (>) for plain-text replies', () => {
    const body = 'OK on my end.\n> earlier you wrote:\n> please unsubscribe me';
    expect(stripQuotedReply(body)).toBe('OK on my end.');
  });

  it('takes the earliest marker when several patterns appear', () => {
    const body =
      'Got it.\n> first quote\nOn 2024 someone wrote:\n-----Original Message-----';
    expect(stripQuotedReply(body)).toBe('Got it.');
  });

  it('returns empty string when the body starts with a quote', () => {
    expect(stripQuotedReply('> previous text only')).toBe('');
  });

  it('handles empty input', () => {
    expect(stripQuotedReply('')).toBe('');
  });
});
