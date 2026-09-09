/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import { parse } from 'csv-parse/sync';
import type { ContactRow } from '../../../src/shared/domain.js';
import { writeCsv } from '../../../src/main/export/csv-exporter.js';
import { collectIntoBuffer, makeContact } from './_helpers.js';

describe('writeCsv', () => {
  it('prepends UTF-8 BOM and writes header + data rows', async () => {
    const rows = [
      makeContact({ email: 'a@x.com', countIn: 3, countOut: 2, total: 5 }),
      makeContact({ email: 'b@x.com', countIn: 1, countOut: 1, total: 2 }),
    ];
    const buf = await collectIntoBuffer((w) => writeCsv(rows, [], w));

    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);

    const content = buf.subarray(3).toString('utf8');
    const records = parse(content, { columns: true, bom: false }) as Record<
      string,
      string
    >[];
    expect(records).toHaveLength(2);
    expect(records[0]?.['Email']).toBe('a@x.com');
    expect(records[0]?.['Display Names']).toBe('Jane Doe');
    expect(records[0]?.['First Message']).toBe('2024-01-01T10:00:00.000Z');
    expect(records[0]?.['Inbound']).toBe('3');
    expect(records[1]?.['Email']).toBe('b@x.com');
  });

  it('honors a custom column subset and ordering', async () => {
    const rows = [makeContact({ email: 'a@x.com' })];
    const buf = await collectIntoBuffer((w) => writeCsv(rows, ['total', 'email'], w));
    const content = buf.subarray(3).toString('utf8');
    const lines = content.trim().split(/\r?\n/);
    expect(lines[0]).toBe('Total Messages,Email');
    expect(lines[1]).toBe('15,a@x.com');
  });

  it('writes header-only when rows are empty', async () => {
    const buf = await collectIntoBuffer((w) => writeCsv([], [], w));
    const content = buf.subarray(3).toString('utf8');
    const lines = content.trim().split(/\r?\n/).filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Email');
    expect(lines[0]).toContain('Display Names');
  });

  it('escapes commas and quotes in subject samples', async () => {
    const rows = [
      makeContact({
        subjectsSample: ['Re: hi, "important"', 'next, please'],
      }),
    ];
    const buf = await collectIntoBuffer((w) => writeCsv(rows, [], w));
    const content = buf.subarray(3).toString('utf8');
    const records = parse(content, { columns: true, bom: false }) as Record<
      string,
      string
    >[];
    expect(records[0]?.['Sample Subjects']).toBe(
      'Re: hi, "important" | next, please',
    );
  });

  it('writes 10k rows in well under 5 s', async () => {
    const rows: ContactRow[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      rows.push(
        makeContact({
          email: `user${i}@example.com`,
          countIn: i,
          countOut: i % 7,
          total: i + (i % 7),
        }),
      );
    }
    const start = performance.now();
    const buf = await collectIntoBuffer((w) => writeCsv(rows, [], w));
    const ms = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(
      `[bench] csv 10k rows -> ${(buf.length / 1024).toFixed(1)} KB in ${ms.toFixed(0)} ms`,
    );
    expect(ms).toBeLessThan(5_000);
  });
});
