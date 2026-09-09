/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { ContactRow } from '../../../src/shared/domain.js';
import { writeXlsx, SHEET_NAME } from '../../../src/main/export/xlsx-exporter.js';
import { collectIntoBuffer, makeContact } from './_helpers.js';

async function loadWorkbook(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // exceljs's xlsx.load type predates BufferLike; coerce.
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

describe('writeXlsx', () => {
  it('writes a Contacts sheet with bold frozen header and the spec column order', async () => {
    const rows = [makeContact({ email: 'a@x.com' })];
    const buf = await collectIntoBuffer((w) => writeXlsx(rows, [], w));
    const wb = await loadWorkbook(buf);
    const ws = wb.getWorksheet(SHEET_NAME);
    expect(ws).toBeDefined();

    const view = ws!.views?.[0] as { state?: string; ySplit?: number } | undefined;
    expect(view?.state).toBe('frozen');
    expect(view?.ySplit).toBe(1);

    const header = ws!.getRow(1);
    expect(header.font?.bold).toBe(true);
    expect(header.getCell(1).value).toBe('Email');
    expect(header.getCell(2).value).toBe('Display Names');
    expect(header.getCell(3).value).toBe('First Message');
    expect(header.getCell(4).value).toBe('Last Message');
    expect(header.getCell(5).value).toBe('Total Messages');
    expect(header.getCell(6).value).toBe('Inbound');
    expect(header.getCell(7).value).toBe('Outbound');
    expect(header.getCell(8).value).toBe('Sample Subjects');

    const dataRow = ws!.getRow(2);
    expect(dataRow.getCell(1).value).toBe('a@x.com');
    expect(dataRow.getCell(2).value).toBe('Jane Doe');
    expect(dataRow.getCell(3).value).toBe('2024-01-01T10:00:00.000Z');
    expect(dataRow.getCell(5).value).toBe(15);
    expect(dataRow.getCell(6).value).toBe(10);
    expect(dataRow.getCell(8).value).toBe('Project update | Q1 review');
  });

  it('writes header-only when rows are empty', async () => {
    const buf = await collectIntoBuffer((w) => writeXlsx([], [], w));
    const wb = await loadWorkbook(buf);
    const ws = wb.getWorksheet(SHEET_NAME);
    expect(ws).toBeDefined();
    expect(ws!.rowCount).toBe(1);
  });

  it('caps long-text column widths at the registry cap (60 + padding)', async () => {
    const longSubject = 'x'.repeat(500);
    const rows = [makeContact({ subjectsSample: [longSubject] })];
    const buf = await collectIntoBuffer((w) => writeXlsx(rows, [], w));
    const wb = await loadWorkbook(buf);
    const ws = wb.getWorksheet(SHEET_NAME);
    const subjectsColumnWidth = ws!.getColumn(8).width;
    expect(subjectsColumnWidth).toBeDefined();
    expect(subjectsColumnWidth!).toBeLessThanOrEqual(62);
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
    const buf = await collectIntoBuffer((w) => writeXlsx(rows, [], w));
    const ms = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(
      `[bench] xlsx 10k rows -> ${(buf.length / 1024).toFixed(1)} KB in ${ms.toFixed(0)} ms`,
    );
    expect(ms).toBeLessThan(5_000);
  });
});
