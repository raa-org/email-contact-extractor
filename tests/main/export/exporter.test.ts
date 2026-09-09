/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { runExport } from '../../../src/main/export/exporter.js';
import { makeContact } from './_helpers.js';

describe('runExport facade', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cx-export-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a real XLSX file at the requested path', async () => {
    const out = join(dir, 'out.xlsx');
    const result = await runExport([makeContact({ email: 'a@x.com' })], {
      format: 'xlsx',
      columns: ['email', 'total'],
      filePath: out,
    });
    expect(result.filePath).toBe(out);
    expect(result.rowsExported).toBe(1);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(readFileSync(out) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Contacts');
    expect(ws).toBeDefined();
    expect(ws!.getRow(1).getCell(1).value).toBe('Email');
    expect(ws!.getRow(2).getCell(1).value).toBe('a@x.com');
  });

  it('writes a real CSV file with BOM at the requested path', async () => {
    const out = join(dir, 'out.csv');
    const result = await runExport([makeContact({ email: 'a@x.com' })], {
      format: 'csv',
      columns: ['email', 'total'],
      filePath: out,
    });
    expect(result.rowsExported).toBe(1);

    const buf = readFileSync(out);
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
    const content = buf.subarray(3).toString('utf8');
    expect(content).toContain('a@x.com');
    expect(content).toContain('Email,Total Messages');
  });
});
