/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { Writable } from 'node:stream';
import { stringify } from 'csv-stringify';
import type { ContactRow, ExportColumn } from '../../shared/domain.js';
import { resolveColumns } from './columns.js';

// UTF-8 BOM — Excel on Windows needs this to detect UTF-8 in CSV.
const BOM = '\uFEFF';

export interface WriteResult {
  readonly rowsExported: number;
}

// Streams rows through csv-stringify into the writable. Memory stays O(1)
// regardless of row count.
export function writeCsv(
  rows: readonly ContactRow[],
  columnIds: readonly ExportColumn[],
  writable: Writable,
): Promise<WriteResult> {
  const cols = resolveColumns(columnIds);

  return new Promise<WriteResult>((resolve, reject) => {
    writable.on('error', reject);
    writable.on('finish', () => resolve({ rowsExported: rows.length }));

    writable.write(BOM, (err) => {
      if (err) {
        reject(err);
        return;
      }
      const stringifier = stringify({
        header: true,
        columns: cols.map((c) => ({ key: c.id, header: c.label })),
      });
      stringifier.on('error', reject);
      stringifier.pipe(writable, { end: true });

      for (const row of rows) {
        const record: Record<string, string | number> = {};
        for (const c of cols) record[c.id] = c.getter(row);
        stringifier.write(record);
      }
      stringifier.end();
    });
  });
}
