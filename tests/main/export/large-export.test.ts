/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { writeCsv } from '../../../src/main/export/csv-exporter.js';
import { writeXlsx, SHEET_NAME } from '../../../src/main/export/xlsx-exporter.js';
import { DEFAULT_COLUMNS } from '../../../src/main/export/columns.js';
import { collectIntoBuffer, makeContact } from './_helpers.js';

// Regression — user reported only 5 000 rows landing in the exported
// XLSX / CSV while `[ipc] export.run wrote 15 972 rows` was logged on
// the main side. These tests pump 15 000 rows through both writers
// and count what actually lands in the resulting buffer. If either
// exporter silently truncates, the assertion at the bottom fires.

const ROW_COUNT = 15_000;

function makeRows(n: number): ReturnType<typeof makeContact>[] {
  return Array.from({ length: n }, (_, i) =>
    makeContact({
      email: `contact-${i}@example.com`,
      countIn: i,
      countOut: i + 1,
      total: i + i + 1,
    }),
  );
}

describe('exporters on 15k rows — no silent truncation', () => {
  it('writeCsv emits one header line + 15 000 data lines', async () => {
    const rows = makeRows(ROW_COUNT);
    const buf = await collectIntoBuffer((writable) =>
      writeCsv(rows, DEFAULT_COLUMNS, writable),
    );
    // BOM + header + N data lines, separated by \n (csv-stringify's
    // default record_delimiter is auto-detected). Stripping the BOM
    // byte then counting \n-terminated chunks gives us exact row count.
    const text = buf.toString('utf8').replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    // First line is the header; expect data rows == ROW_COUNT.
    expect(lines.length).toBe(ROW_COUNT + 1);
  });

  it('writeXlsx materialises 15 000 + 1 rows in the workbook', async () => {
    const rows = makeRows(ROW_COUNT);
    const buf = await collectIntoBuffer((writable) =>
      writeXlsx(rows, DEFAULT_COLUMNS, writable),
    );
    const wb = new ExcelJS.Workbook();
    // exceljs.xlsx.load() typings pre-date Node 24's generic
    // `Buffer<ArrayBufferLike>` (vs `Buffer<ArrayBuffer>`). A normal
    // cast doesn't shake it because the generic parameter survives
    // every step of TS's structural check. Suppress at the call
    // site — bit-identical at runtime, exceljs is happy with any
    // Uint8Array-backed buffer.
    // @ts-expect-error see comment above
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet(SHEET_NAME);
    expect(ws).toBeDefined();
    // exceljs ws.rowCount counts ALL rows including the header.
    expect(ws!.rowCount).toBe(ROW_COUNT + 1);
    // Spot-check the first/last data row to verify nothing got
    // truncated AND nothing got reordered into oblivion.
    expect(ws!.getCell(2, 1).value).toBe('contact-0@example.com');
    expect(ws!.getCell(ROW_COUNT + 1, 1).value).toBe(
      `contact-${ROW_COUNT - 1}@example.com`,
    );
  });
});
