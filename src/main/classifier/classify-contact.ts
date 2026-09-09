/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { ParsedHeaders } from '../imap/headers.js';
import {
  type HeuristicsConfig,
} from '../../shared/heuristics-config.js';
import { isAutomationHeader } from './rules/is-automation-header.js';
import { isAutomationLocalPart } from './rules/is-automation-localpart.js';
import { isBidirectional } from './rules/is-bidirectional.js';

// Aggregated view of a single contact, fed into the classifier.
// `sampleMessages` is a representative subset of the headers we have for
// this contact — the pipeline picks them when building the summary.
export interface ContactSummary {
  readonly emailNormalized: string;
  readonly countIn: number;
  readonly countOut: number;
  readonly sampleMessages: readonly ParsedHeaders[];
}

export type ClassificationReason =
  | 'not-bidirectional'
  | 'automation-localpart'
  | 'all-messages-automated';

export interface ClassificationResult {
  readonly keep: boolean;
  readonly reasons: readonly ClassificationReason[];
}

// `reasons` lists every disqualifying rule that fired. `keep` is true
// only when no rule fired. Surface the reasons in the UI for explainability.
export function classifyContact(
  contact: ContactSummary,
  config: HeuristicsConfig,
): ClassificationResult {
  const reasons: ClassificationReason[] = [];
  const email = contact.emailNormalized;

  if (!isBidirectional(contact.countIn, contact.countOut, config.bidirectionality)) {
    reasons.push('not-bidirectional');
  }

  if (isAutomationLocalPart(email, config.automationLocalPartRegex)) {
    reasons.push('automation-localpart');
  } else if (
    contact.sampleMessages.length > 0 &&
    contact.sampleMessages.every((h) => isAutomationHeader(h))
  ) {
    // Per §4: a contact is flagged automated only if EVERY message we have
    // from them is automated. One legit message rescues them.
    reasons.push('all-messages-automated');
  }

  return { keep: reasons.length === 0, reasons };
}
