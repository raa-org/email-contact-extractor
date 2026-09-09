/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { domainPart } from '../../../shared/email-normalize.js';

// Returns true if `email`'s domain matches any entry in `domains`. Exact
// match OR subdomain match (e.g. `dev.example.com` matches when
// `example.com` is listed). Lower-cased on both sides so callers
// don't need to pre-normalize.
//
// Used twice in the aggregator with opposite polarity:
//   • `excludeDomains` — drop the contact when this returns true (the
//     classic "internal organization" filter from CLAUDE.md §3).
//   • `includeDomains` — keep the contact when this returns true (a
//     user-authored whitelist).
// Naming this "isDomainInList" rather than "isInternalDomain" reflects
// the actual semantics — the function doesn't know or care whether the
// list represents your own org or a curated allow-list.
export function isDomainInList(
  email: string,
  domains: readonly string[],
): boolean {
  const domain = domainPart(email);
  if (!domain) return false;
  for (const raw of domains) {
    const d = raw.trim().toLowerCase();
    if (d.length === 0) continue;
    if (domain === d || domain.endsWith(`.${d}`)) return true;
  }
  return false;
}
