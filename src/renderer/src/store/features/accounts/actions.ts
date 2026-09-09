/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { createAction, createAsyncAction } from 'typesafe-actions';
import type { AccountSummary } from '../../../../../shared/ipc-contracts.js';

export const fetch = createAsyncAction(
  'accounts/fetch/request',
  'accounts/fetch/success',
  'accounts/fetch/failure',
)<void, { accounts: readonly AccountSummary[] }, { error: string }>();

export const remove = createAsyncAction(
  'accounts/remove/request',
  'accounts/remove/success',
  'accounts/remove/failure',
)<{ id: number }, { id: number }, { id: number; error: string }>();

// Re-test a previously saved account by id; on success the renderer should
// navigate to /scan (handled by ConnectScreen). The action mirrors the
// bootstrap "needs credentials" branch on failure: surfaces the underlying
// error and prefills the form via the accounts-prefill epic.
export const useSaved = createAsyncAction(
  'accounts/useSaved/request',
  'accounts/useSaved/success',
  'accounts/useSaved/failure',
)<
  { account: AccountSummary },
  { account: AccountSummary },
  { account: AccountSummary; error: string }
>();

// Cleared by ConnectScreen after it navigates the user to /scan. Lets the
// epic communicate "connection is live, please move on" to the screen
// without coupling the epic to the router.
export const navigationConsumed = createAction('accounts/navigationConsumed')();
