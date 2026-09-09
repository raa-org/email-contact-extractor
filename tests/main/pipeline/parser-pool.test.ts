/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import { createInlineParser } from '../../../src/main/pipeline/parser-pool.js';

// Worker-pool variant requires a compiled `out/main/parser-worker.js`,
// which only exists after `npm run build` — the unit suite would have
// to spawn an electron-vite compile to test it, which conflates layers.
// Instead, the worker-pool path is exercised end-to-end by the bench
// harness (`npm run bench:micro` / `bench:e2e`) which is the canonical
// way to verify the parallel path. Inline parser is the one this file
// covers, since it shares the public `Parser` contract with the pool.

const SIMPLE_RFC822 = Buffer.from(
  [
    'From: a@example.com',
    'To: b@example.com',
    'Subject: Test',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Hello, this is the body.',
    '',
  ].join('\r\n'),
  'utf8',
);

describe('createInlineParser', () => {
  it('extracts text/plain content and reports parseMs', async () => {
    const parser = createInlineParser();
    const { text, parseMs } = await parser.parse(SIMPLE_RFC822);
    expect(text).toContain('Hello, this is the body.');
    expect(parseMs).toBeGreaterThanOrEqual(0);
    expect(parser.kind).toBe('inline');
    expect(parser.size).toBe(1);
    await parser.close();
  });

  it('returns empty text on a body with no text part rather than throwing', async () => {
    // Headers only — no body section. mailparser yields text=''.
    const headersOnly = Buffer.from(
      'From: a@example.com\r\nSubject: empty\r\n\r\n',
      'utf8',
    );
    const parser = createInlineParser();
    const { text } = await parser.parse(headersOnly);
    expect(text).toBe('');
    await parser.close();
  });

  it('handles multiple concurrent parses without cross-contamination', async () => {
    const parser = createInlineParser();
    const bodies = Array.from({ length: 8 }, (_, i) =>
      Buffer.from(
        [
          'From: a@example.com',
          'To: b@example.com',
          `Subject: msg-${i}`,
          'Content-Type: text/plain',
          '',
          `BODY-NUMBER-${i}`,
          '',
        ].join('\r\n'),
        'utf8',
      ),
    );
    const results = await Promise.all(bodies.map((b) => parser.parse(b)));
    for (let i = 0; i < results.length; i += 1) {
      expect(results[i]!.text).toContain(`BODY-NUMBER-${i}`);
    }
    await parser.close();
  });
});
