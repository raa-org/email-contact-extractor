/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import { isAutomationHeader } from '../../../../src/main/classifier/rules/is-automation-header.js';
import type { ParsedHeaders } from '../../../../src/main/imap/headers.js';

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

describe('isAutomationHeader', () => {
  it('positive: Auto-Submitted = auto-generated', () => {
    expect(isAutomationHeader(H({ autoSubmitted: 'auto-generated' }))).toBe(true);
  });

  it('positive: Auto-Submitted = AUTO-REPLIED (case-insensitive)', () => {
    expect(isAutomationHeader(H({ autoSubmitted: 'AUTO-REPLIED' }))).toBe(true);
  });

  it('negative: Auto-Submitted = no', () => {
    expect(isAutomationHeader(H({ autoSubmitted: 'no' }))).toBe(false);
  });

  it('positive: Precedence = bulk / list / junk', () => {
    expect(isAutomationHeader(H({ precedence: 'bulk' }))).toBe(true);
    expect(isAutomationHeader(H({ precedence: 'LIST' }))).toBe(true);
    expect(isAutomationHeader(H({ precedence: 'junk' }))).toBe(true);
  });

  it('negative: Precedence = first-class / urgent', () => {
    expect(isAutomationHeader(H({ precedence: 'first-class' }))).toBe(false);
    expect(isAutomationHeader(H({ precedence: 'urgent' }))).toBe(false);
  });

  it('positive: List-Unsubscribe present', () => {
    expect(isAutomationHeader(H({ hasListUnsubscribe: true }))).toBe(true);
  });

  it('positive: List-Id present', () => {
    expect(isAutomationHeader(H({ hasListId: true }))).toBe(true);
  });

  it('negative: empty headers', () => {
    expect(isAutomationHeader(H({}))).toBe(false);
  });

  it('handles whitespace around values', () => {
    expect(isAutomationHeader(H({ precedence: '  Bulk  ' }))).toBe(true);
    expect(isAutomationHeader(H({ autoSubmitted: '  no  ' }))).toBe(false);
  });
});
