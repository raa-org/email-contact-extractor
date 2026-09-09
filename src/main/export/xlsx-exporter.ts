/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { Writable } from 'node:stream';
import ExcelJS from 'exceljs';
import type { ContactRow, ExportColumn } from '../../shared/domain.js';
import { resolveColumns } from './columns.js';

export const SHEET_NAME = 'Contacts';
const WIDTH_PADDING = 2;

export interface WriteResult {
  readonly rowsExported: number;
}

// Buffers the workbook in memory (exceljs streaming API is awkward and the
// 10k-row perf test shows in-memory write fits comfortably under 5s).
export async function writeXlsx(
  rows: readonly ContactRow[],
  columnIds: readonly ExportColumn[],
  writable: Writable,
): Promise<WriteResult> {
  const cols = resolveColumns(columnIds);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = cols.map((c) => ({ header: c.label, key: c.id }));
  ws.getRow(1).font = { bold: true };

  for (const row of rows) {
    const record: Record<string, string | number> = {};
    for (const c of cols) record[c.id] = c.getter(row);
    ws.addRow(record);
  }

  for (let i = 0; i < cols.length; i += 1) {
    const c = cols[i]!;
    let maxLen = c.label.length;
    for (const row of rows) {
      const v = String(c.getter(row));
      if (v.length > maxLen) maxLen = v.length;
      if (maxLen >= c.widthCap) {
        maxLen = c.widthCap;
        break;
      }
    }
    ws.getColumn(i + 1).width = Math.min(maxLen + WIDTH_PADDING, c.widthCap + WIDTH_PADDING);
  }

  await wb.xlsx.write(writable);
  return { rowsExported: rows.length };
}
