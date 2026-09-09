/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { createAction, createAsyncAction } from 'typesafe-actions';
import type { Credentials, Protocol } from '../../../../../shared/domain.js';

export interface ConnectionFormState {
  readonly presetId: string;
  readonly protocol: Protocol;
  readonly host: string;
  readonly port: number;
  readonly tls: boolean;
  readonly username: string;
  readonly password: string;
  readonly rememberMe: boolean;
}

export interface PrefillFromAccount {
  readonly host: string;
  readonly port: number;
  readonly tls: boolean;
  readonly protocol: Protocol;
  readonly username: string;
  readonly error?: string;
}

// Used by the bootstrap flow: when an auto-resume fails we land on
// /connect with the metadata of the last saved account already filled in
// and the underlying error surfaced. The password field is left empty —
// the user must re-type or pick another saved account.
export const prefillFromAccount = createAction(
  'connection/prefillFromAccount',
)<PrefillFromAccount>();

export const updateForm = createAction('connection/updateForm')<Partial<ConnectionFormState>>();
export const reset = createAction('connection/reset')();

export type TestRequest = Credentials & { readonly rememberMe: boolean };

export const test = createAsyncAction(
  'connection/test/request',
  'connection/test/success',
  'connection/test/failure',
)<TestRequest, { capabilities: readonly string[] }, { error: string }>();
