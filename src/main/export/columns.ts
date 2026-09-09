/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { ContactRow, ExportColumn } from '../../shared/domain.js';

// Single source of truth for export columns. Both XLSX and CSV exporters
// consume this. The Phase 2 dynamic column picker will edit `defaultVisible`
// per user — the registry itself shouldn't change shape.

export interface ColumnDef {
  readonly id: ExportColumn;
  readonly label: string;
  readonly getter: (row: ContactRow) => string | number;
  readonly defaultVisible: boolean;
  // Cap on auto-fit width (in characters). Long string columns (subjects,
  // display names) are capped at 60 per the task spec.
  readonly widthCap: number;
}

const NAMES_JOIN = ', ';
const SUBJECTS_JOIN = ' | ';

export const COLUMN_REGISTRY: Readonly<Record<ExportColumn, ColumnDef>> = {
  email: {
    id: 'email',
    label: 'Email',
    getter: (r) => r.email,
    defaultVisible: true,
    widthCap: 60,
  },
  displayNames: {
    id: 'displayNames',
    label: 'Display Names',
    getter: (r) => r.displayNames.join(NAMES_JOIN),
    defaultVisible: true,
    widthCap: 60,
  },
  firstSeenUtc: {
    id: 'firstSeenUtc',
    label: 'First Message',
    getter: (r) => r.firstSeenUtc,
    defaultVisible: true,
    widthCap: 30,
  },
  lastSeenUtc: {
    id: 'lastSeenUtc',
    label: 'Last Message',
    getter: (r) => r.lastSeenUtc,
    defaultVisible: true,
    widthCap: 30,
  },
  total: {
    id: 'total',
    label: 'Total Messages',
    getter: (r) => r.total,
    defaultVisible: true,
    widthCap: 18,
  },
  countIn: {
    id: 'countIn',
    label: 'Inbound',
    getter: (r) => r.countIn,
    defaultVisible: true,
    widthCap: 12,
  },
  countOut: {
    id: 'countOut',
    label: 'Outbound',
    getter: (r) => r.countOut,
    defaultVisible: true,
    widthCap: 12,
  },
  subjectsSample: {
    id: 'subjectsSample',
    label: 'Sample Subjects',
    getter: (r) => r.subjectsSample.join(SUBJECTS_JOIN),
    defaultVisible: true,
    widthCap: 60,
  },
};

// The order columns appear in by default. Any subset selected by the user
// is also honored in user-supplied order.
export const DEFAULT_COLUMNS: readonly ExportColumn[] = [
  'email',
  'displayNames',
  'firstSeenUtc',
  'lastSeenUtc',
  'total',
  'countIn',
  'countOut',
  'subjectsSample',
];

// Returns ColumnDef[] in the order requested. Empty/missing input falls
// back to DEFAULT_COLUMNS.
export function resolveColumns(ids?: readonly ExportColumn[]): readonly ColumnDef[] {
  const list = ids && ids.length > 0 ? ids : DEFAULT_COLUMNS;
  return list.map((id) => COLUMN_REGISTRY[id]);
}
