/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { createReducer } from 'typesafe-actions';
import type { ContactRow } from '../../../../../shared/domain.js';
import * as a from './actions.js';
import * as session from '../session/actions.js';
import * as accounts from '../accounts/actions.js';

export interface ContactsState {
  readonly rows: readonly ContactRow[];
  readonly total: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly query: string;
}

export const initialState: ContactsState = {
  rows: [],
  total: 0,
  loading: false,
  error: null,
  query: '',
};

// Wipe cached contacts whenever the active session changes — otherwise
// ResultsScreen's guard (`fallbackRows.length === 0`) short-circuits and
// keeps rendering the previous account's rows. The four "session change"
// triggers below are the only ways the renderer ever flips who's active;
// catching them all here means no individual call site has to remember
// to also dispatch contacts.reset.
//   • a.reset            — explicit (Reset Cache, future use)
//   • session.clear      — Switch account button
//   • session.setActive  — manual Continue after testConnection
//   • accounts.useSaved.success — saved-account "Use" click
//   • accounts.remove.success  — deleting an account (possibly the active one)
export const contactsReducer = createReducer<ContactsState>(initialState)
  .handleAction(a.fetch.request, (state) => ({ ...state, loading: true, error: null }))
  .handleAction(a.fetch.success, (state, action) => ({
    ...state,
    loading: false,
    rows: action.payload.rows,
    total: action.payload.total,
  }))
  .handleAction(a.fetch.failure, (state, action) => ({
    ...state,
    loading: false,
    error: action.payload.error,
  }))
  .handleAction(a.setQuery, (state, action) => ({ ...state, query: action.payload }))
  .handleAction(
    [
      a.reset,
      session.clear,
      session.setActive,
      accounts.useSaved.success,
      accounts.remove.success,
    ],
    () => initialState,
  );
