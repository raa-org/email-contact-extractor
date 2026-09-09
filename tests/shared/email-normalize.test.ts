/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import {
  domainPart,
  localPart,
  normalizeEmail,
} from '../../src/shared/email-normalize.js';

describe('normalizeEmail', () => {
  it('trims and lowercases the address', () => {
    expect(normalizeEmail('  Foo@Bar.COM  ')).toBe('foo@bar.com');
  });

  it('preserves dots in the local part for ALL providers, including gmail', () => {
    // Gmail-the-mailbox-server treats jana.voloskova and janavoloskova as
    // the same inbox, but for OUR display we keep the address as written.
    expect(normalizeEmail('jana.voloskova@gmail.com')).toBe(
      'jana.voloskova@gmail.com',
    );
    expect(normalizeEmail('first.last@example.com')).toBe(
      'first.last@example.com',
    );
  });

  it('preserves +tag suffixes for ALL providers', () => {
    expect(normalizeEmail('alice+work@gmail.com')).toBe('alice+work@gmail.com');
    expect(normalizeEmail('alice+random@googlemail.com')).toBe(
      'alice+random@googlemail.com',
    );
    expect(normalizeEmail('foo+bar@example.com')).toBe('foo+bar@example.com');
  });

  it('preserves the original gmail/googlemail domain (no aliasing)', () => {
    expect(normalizeEmail('a@gmail.com')).toBe('a@gmail.com');
    expect(normalizeEmail('a@googlemail.com')).toBe('a@googlemail.com');
  });

  it('handles empty string', () => {
    expect(normalizeEmail('')).toBe('');
  });

  it('returns trimmed/lowercased string when no @ present', () => {
    expect(normalizeEmail('  Not-Email ')).toBe('not-email');
  });

  it('accepts internationalized (punycode) domains as-is', () => {
    expect(normalizeEmail('user@xn--mxa.com')).toBe('user@xn--mxa.com');
  });

  it('lowercases domain even when local part is empty/odd', () => {
    expect(normalizeEmail('@FOO.COM')).toBe('@foo.com');
  });
});

describe('localPart / domainPart', () => {
  it('splits at the LAST @', () => {
    expect(localPart('a@b@example.com')).toBe('a@b');
    expect(domainPart('a@b@example.com')).toBe('example.com');
  });

  it('returns null domain for strings without @', () => {
    expect(domainPart('not-an-email')).toBeNull();
    expect(localPart('not-an-email')).toBe('not-an-email');
  });

  it('lowercases domain part', () => {
    expect(domainPart('foo@EXAMPLE.com')).toBe('example.com');
  });
});
