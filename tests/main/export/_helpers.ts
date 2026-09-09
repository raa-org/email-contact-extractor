/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { Writable } from 'node:stream';
import type { ContactRow } from '../../../src/shared/domain.js';

export function collectIntoBuffer(
  write: (writable: Writable) => Promise<unknown>,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      },
    });
    writable.on('error', reject);
    writable.on('finish', () => resolve(Buffer.concat(chunks)));
    void write(writable)
      .then(() => {
        if (!writable.writableEnded) writable.end();
      })
      .catch(reject);
  });
}

export function makeContact(overrides: Partial<ContactRow> = {}): ContactRow {
  return {
    email: 'partner@example.com',
    firstSeenUtc: '2024-01-01T10:00:00.000Z',
    lastSeenUtc: '2024-12-31T23:59:00.000Z',
    countIn: 10,
    countOut: 5,
    total: 15,
    subjectsSample: ['Project update', 'Q1 review'],
    displayNames: ['Jane Doe'],
    ...overrides,
  };
}
