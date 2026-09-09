/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

// Detects "reply with unsubscribe"-style instructions embedded in the
// message body (or subject) — the case `List-Unsubscribe` headers can't
// catch because the sender ran a manual / semi-manual list and never set
// up RFC 2369 unsubscription.
//
// The regex (default in `src/shared/heuristics-config.ts`) is intentionally
// strict: it requires an instruction cue (`reply`/`send`) in proximity to
// the word `unsubscribe`, so a normal conversation that mentions the word
// in passing ("I couldn't unsubscribe from their newsletter") doesn't
// false-match. The match runs against `subject + " " + body` so an
// unsubscribe directive in either field is enough.
export function isInlineUnsubscribe(
  subject: string | null,
  body: string | null,
  regex: RegExp,
): boolean {
  if (subject === null && body === null) return false;
  const haystack = `${subject ?? ''} ${body ?? ''}`;
  if (haystack.trim().length === 0) return false;
  return regex.test(haystack);
}
