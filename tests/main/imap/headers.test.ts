/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import { parseHeaders } from '../../../src/main/imap/headers.js';

function H(entries: Record<string, string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(entries)) m.set(k.toLowerCase(), v);
  return m;
}

describe('parseHeaders', () => {
  it('parses From with display name and address', async () => {
    const result = await parseHeaders(
      H({ from: '"Jane Doe" <jane.doe@example.com>' }),
    );
    expect(result.from).toEqual({ email: 'jane.doe@example.com', name: 'Jane Doe' });
  });

  it('parses From with bare address', async () => {
    const result = await parseHeaders(H({ from: 'jane@example.com' }));
    expect(result.from).toEqual({ email: 'jane@example.com' });
  });

  it('parses To with multiple recipients', async () => {
    const result = await parseHeaders(
      H({ to: 'a@example.com, "Bob" <b@example.com>, c@example.com' }),
    );
    expect(result.to.map((r) => r.email)).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
    ]);
    expect(result.to[1]?.name).toBe('Bob');
  });

  it('decodes RFC 2047 encoded subjects', async () => {
    const result = await parseHeaders(
      H({ subject: '=?UTF-8?B?0J/RgNC40LLQtdGCINC80LjRgA==?=' }),
    );
    expect(result.subject).toBe('Привет мир');
  });

  it('decodes RFC 2047 encoded From display name', async () => {
    const result = await parseHeaders(
      H({ from: '=?UTF-8?B?0JjQstCw0L0=?= <ivan@example.com>' }),
    );
    expect(result.from).toEqual({ email: 'ivan@example.com', name: 'Иван' });
  });

  it('parses References as a list of message-ids', async () => {
    const result = await parseHeaders(
      H({ references: '<a@x.com> <b@x.com>\r\n  <c@x.com>' }),
    );
    expect(result.references).toEqual(['<a@x.com>', '<b@x.com>', '<c@x.com>']);
  });

  it('detects List-Unsubscribe and List-Id presence', async () => {
    const result = await parseHeaders(
      H({
        from: 'news@example.com',
        'list-unsubscribe': '<mailto:unsubscribe@example.com>',
        'list-id': 'Newsletter <news.example.com>',
        precedence: 'bulk',
        'auto-submitted': 'auto-generated',
      }),
    );
    expect(result.hasListUnsubscribe).toBe(true);
    expect(result.hasListId).toBe(true);
    expect(result.listUnsubscribe).toContain('unsubscribe@example.com');
    expect(result.listId).toContain('news.example.com');
    expect(result.precedence).toBe('bulk');
    expect(result.autoSubmitted).toBe('auto-generated');
  });

  it('returns empty / null on completely empty headers', async () => {
    const result = await parseHeaders(H({}));
    expect(result.from).toBeNull();
    expect(result.to).toEqual([]);
    expect(result.cc).toEqual([]);
    expect(result.subject).toBeNull();
    expect(result.messageId).toBeNull();
    expect(result.references).toEqual([]);
    expect(result.hasListUnsubscribe).toBe(false);
    expect(result.hasListId).toBe(false);
  });

  it('extracts Message-Id and In-Reply-To', async () => {
    const result = await parseHeaders(
      H({
        'message-id': '<m1@example.com>',
        'in-reply-to': '<m0@example.com>',
      }),
    );
    expect(result.messageId).toBe('<m1@example.com>');
    expect(result.inReplyTo).toBe('<m0@example.com>');
  });
});

