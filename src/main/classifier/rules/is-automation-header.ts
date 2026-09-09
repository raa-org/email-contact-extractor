/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { ParsedHeaders } from '../../imap/headers.js';

// Returns true if the parsed headers indicate the message is automated.
// A message is flagged when ANY of the following is true (per CLAUDE.md §4):
//   - Auto-Submitted header is present and not 'no'
//   - Precedence header value is one of bulk/list/junk
//   - List-Unsubscribe header is present
//   - List-Id header is present
//   - hasInlineUnsubscribe — derived bit from a body match against the
//     inline-unsubscribe regex during deep scan (only set when the user
//     opted into Parse Message Bodies). For legacy / header-only scans
//     it's always false, so behaviour is unchanged.
export function isAutomationHeader(headers: ParsedHeaders): boolean {
  if (headers.autoSubmitted) {
    const v = headers.autoSubmitted.trim().toLowerCase();
    if (v.length > 0 && v !== 'no') return true;
  }
  if (headers.precedence) {
    const p = headers.precedence.trim().toLowerCase();
    if (p === 'bulk' || p === 'list' || p === 'junk') return true;
  }
  if (headers.hasListUnsubscribe) return true;
  if (headers.hasListId) return true;
  if (headers.hasInlineUnsubscribe) return true;
  return false;
}
