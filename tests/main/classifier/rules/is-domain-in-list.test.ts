/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import { isDomainInList } from '../../../../src/main/classifier/rules/is-domain-in-list.js';

describe('isDomainInList', () => {
  const domains = ['example.com'];

  it('returns true for exact domain match', () => {
    expect(isDomainInList('alice@example.com', domains)).toBe(true);
  });

  it('returns true for subdomain match', () => {
    expect(isDomainInList('alice@dev.example.com', domains)).toBe(true);
    expect(isDomainInList('alice@a.b.c.example.com', domains)).toBe(true);
  });

  it('returns false for unrelated domains', () => {
    expect(isDomainInList('alice@other-company.test', domains)).toBe(false);
  });

  it('does NOT match domains that merely end with the same string but no dot', () => {
    expect(isDomainInList('alice@evilexample.com', domains)).toBe(false);
  });

  it('handles mixed-case input', () => {
    expect(isDomainInList('Alice@example.com', domains)).toBe(true);
  });

  it('handles internationalized punycode domains', () => {
    expect(isDomainInList('user@xn--mxa.com', ['xn--mxa.com'])).toBe(true);
    expect(isDomainInList('user@sub.xn--mxa.com', ['xn--mxa.com'])).toBe(true);
  });

  it('returns false on malformed addresses (no @)', () => {
    expect(isDomainInList('not-an-email', domains)).toBe(false);
  });

  it('skips empty / whitespace-only entries in the domain list', () => {
    expect(isDomainInList('alice@example.com', ['', '   ', 'example.com'])).toBe(true);
    expect(isDomainInList('alice@example.com', ['', '   '])).toBe(false);
  });

  it('returns false for empty domain list', () => {
    expect(isDomainInList('alice@example.com', [])).toBe(false);
  });
});
