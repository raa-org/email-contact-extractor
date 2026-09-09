/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { localPart } from '../../../shared/email-normalize.js';

// Returns true if the local part of the address matches the automation
// pattern (noreply, mailer-daemon, postmaster, notifications, etc.). The
// regex lives in heuristics-config.ts; callers may inject their own.
export function isAutomationLocalPart(
  email: string,
  regex: RegExp,
): boolean {
  const lp = localPart(email).trim().toLowerCase();
  if (lp.length === 0) return false;
  return regex.test(lp);
}
