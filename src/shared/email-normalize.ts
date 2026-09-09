/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

// Email normalization rules — single source of truth, tested separately.
//
// Decisions documented for the project:
//   1. Trim outer whitespace and lowercase the entire address. Email
//      addresses are case-insensitive in the domain part per RFC 5321;
//      the local part is technically case-sensitive but real-world
//      providers treat it as case-insensitive, and we follow the real
//      world.
//   2. We deliberately do NOT apply provider-specific aliasing such as
//      Gmail's "drop dots" / "drop +tag" rule. Those rules are correct
//      from Google's mailbox-routing perspective (jana.voloskova@gmail.com
//      and janavoloskova@gmail.com both arrive at the same inbox), but
//      they would distort the *display* — the contact list ends up
//      showing addresses the sender never wrote, which surprises users
//      and breaks search-by-pasted-address. We keep the address as the
//      sender wrote it; equivalence across these aliases is a separate
//      concern that the MVP does not need to resolve.
//   3. Internationalised domain names (IDNs) are accepted as-is. We
//      expect the punycode form (xn--...) coming from IMAP headers and
//      we do not convert between Unicode and punycode here. Matching is
//      byte-exact on the lowercased domain.
//   4. Strings without '@' are returned trimmed+lowercased without
//      further transformation — the caller decides whether to treat
//      them as invalid.
//   5. The function is pure: same input always produces the same
//      output; no I/O, no clocks, no globals.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function localPart(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? email : email.slice(0, at);
}

export function domainPart(email: string): string | null {
  const at = email.lastIndexOf('@');
  return at === -1 ? null : email.slice(at + 1).toLowerCase();
}
