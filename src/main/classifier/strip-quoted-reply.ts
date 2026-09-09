/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

// Cuts a plain-text mail body at the first quoted-reply marker so word
// filters only see what the message author actually wrote — without the
// previous-letter chain that comes back attached to every reply. Patterns
// covered: Apple/Gmail/Thunderbird "On <date>, <name> wrote:" attribution,
// Outlook "-----Original Message-----" divider, and `>`-prefixed quote
// lines (RFC 3676 conventional plain-text reply marker).
//
// The cut is "earliest marker wins": we run all patterns, take the lowest
// match offset, slice up to it. If no marker matches, the whole body is
// returned unchanged. The result is `.trim()`ed so we don't leave trailing
// whitespace before the cut.
//
// Subjects don't need this — they only ever pick up an "Re:" / "Fwd:"
// prefix, never multi-line history.
const REPLY_ATTRIBUTION = /^On\b[\s\S]{0,300}?\bwrote:\s*$/im;
const OUTLOOK_DIVIDER = /^-{2,}\s*Original Message\s*-{2,}\s*$/im;
const QUOTED_LINE = /^>/m;

export function stripQuotedReply(body: string): string {
  if (body.length === 0) return body;
  let cut = body.length;
  for (const re of [REPLY_ATTRIBUTION, OUTLOOK_DIVIDER, QUOTED_LINE]) {
    const m = re.exec(body);
    if (m && m.index < cut) cut = m.index;
  }
  return body.slice(0, cut).trim();
}
