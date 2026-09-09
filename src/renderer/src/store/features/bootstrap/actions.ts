/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { createAction } from 'typesafe-actions';
import type { AccountSummary } from '../../../../../shared/ipc-contracts.js';

// Bootstrap drives the very first UI paint — splash → either auto-resumed
// /scan, or /connect with the last account's metadata pre-filled.
//
// 'connected'         → main rehydrated the saved credential and the IMAP
//                       session is live; gate redirects to /scan.
// 'needsCredentials'  → we have a saved account but couldn't auto-connect
//                       (decryption unavailable, network error, server
//                       rejected creds). Form is prefilled, user retypes
//                       password or picks another saved account.
// 'empty'             → no saved account at all; gate just renders the
//                       normal /connect screen with default form values.
export type BootstrapOutcome =
  | { readonly kind: 'connected'; readonly account: AccountSummary }
  | {
      readonly kind: 'needsCredentials';
      readonly account: AccountSummary;
      readonly error: string;
    }
  | { readonly kind: 'empty' };

export const start = createAction('bootstrap/start')();
export const done = createAction('bootstrap/done')<BootstrapOutcome>();
