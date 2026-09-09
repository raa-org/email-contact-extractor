/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { ParsedHeaders } from '../imap/headers.js';
import { normalizeEmail } from '../../shared/email-normalize.js';

export interface DeriveMyAddressesInput {
  readonly loginAddress: string;
  // headers from messages found in folders flagged as Sent (\Sent specialUse).
  // Pass an empty iterable if no Sent folder exists — we'll fall back to
  // just the login address.
  readonly sentHeaders: Iterable<ParsedHeaders>;
}

// Returns the normalized set of addresses the user authors mail FROM.
// Always includes the login address. Each header from a Sent-flagged
// folder contributes its From address. Empty / malformed values are
// skipped silently.
export function deriveMyAddresses(input: DeriveMyAddressesInput): Set<string> {
  const out = new Set<string>();
  const login = normalizeEmail(input.loginAddress).trim();
  if (login.length > 0) out.add(login);

  for (const h of input.sentHeaders) {
    const fromEmail = h.from?.email;
    if (!fromEmail) continue;
    const norm = normalizeEmail(fromEmail);
    if (norm.length > 0) out.add(norm);
  }

  return out;
}
