/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { createWriteStream } from 'node:fs';
import type { Writable } from 'node:stream';
import type { ContactRow, ExportOptions } from '../../shared/domain.js';
import { writeCsv } from './csv-exporter.js';
import { writeXlsx } from './xlsx-exporter.js';

export interface ExportResult {
  readonly filePath: string;
  readonly rowsExported: number;
}

// Facade. The exporter does NOT touch the DB — caller hands it the rows.
// Dispatches by ExportOptions.format. Writes to ExportOptions.filePath.
export async function runExport(
  rows: readonly ContactRow[],
  options: ExportOptions,
): Promise<ExportResult> {
  const writable = createWriteStream(options.filePath);
  const finished = new Promise<void>((resolve, reject) => {
    writable.once('finish', () => resolve());
    writable.once('error', reject);
  });
  try {
    const { rowsExported } = await writeToStream(rows, options, writable);
    if (!writable.writableEnded) writable.end();
    await finished;
    return { filePath: options.filePath, rowsExported };
  } catch (err) {
    writable.destroy();
    throw err;
  }
}

// Same dispatch but accepts any Writable — primarily for tests.
export async function writeToStream(
  rows: readonly ContactRow[],
  options: ExportOptions,
  writable: Writable,
): Promise<{ rowsExported: number }> {
  if (options.format === 'xlsx') {
    return writeXlsx(rows, options.columns, writable);
  }
  if (options.format === 'csv') {
    return writeCsv(rows, options.columns, writable);
  }
  throw new Error(`Unknown export format: ${String(options.format)}`);
}
