/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { ParsedHeaders } from '../imap/headers.js';
import { normalizeEmail } from '../../shared/email-normalize.js';

export type Direction = 'in' | 'out' | 'self';

// Direction precedence (resolved top-down on the first match):
//   1. From is missing or has no address     -> 'in'
//      (we received it; sender unknown)
//   2. From is the user AND there is at least -> 'self'
//      one recipient AND EVERY recipient is
//      also the user — note-to-self / drafts.
//   3. From is the user                      -> 'out'
//      (covers group emails where the user is
//      one of several recipients, e.g. cc'ing
//      self for archive — every external
//      recipient must still be counted as 'out')
//   4. Otherwise                             -> 'in'
//
// `myAddresses` MUST already be normalized (lowercased, gmail-stripped)
// — derive-my-addresses.ts produces such a set.
export function computeDirection(
  parsed: ParsedHeaders,
  myAddresses: ReadonlySet<string>,
): Direction {
  const fromEmail = parsed.from?.email
    ? normalizeEmail(parsed.from.email)
    : null;

  if (!fromEmail) return 'in';

  const fromIsMine = myAddresses.has(fromEmail);
  if (!fromIsMine) return 'in';

  const recipients = [...parsed.to, ...parsed.cc];
  if (recipients.length === 0) return 'out';
  const allRecipientsMine = recipients.every((r) =>
    myAddresses.has(normalizeEmail(r.email)),
  );

  return allRecipientsMine ? 'self' : 'out';
}
