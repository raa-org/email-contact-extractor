/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { createReducer } from 'typesafe-actions';
import type { AccountSummary } from '../../../../../shared/ipc-contracts.js';
import * as a from './actions.js';

export interface AccountsState {
  readonly list: readonly AccountSummary[];
  readonly loading: boolean;
  readonly error: string | null;
  // Per-id status for in-flight delete / useSaved actions so the row UI
  // can disable buttons and surface a spinner on the right account. Kept
  // as a plain array (not Set) so Redux's serializability checks stay
  // happy and devtools can replay actions without TypeError on Set.
  readonly busyIds: readonly number[];
  readonly useSavedError: string | null;
  // Set on useSaved.success; ConnectScreen reads it, navigates to /scan,
  // and dispatches navigationConsumed to clear it.
  readonly navigateToScan: boolean;
}

export const initialState: AccountsState = {
  list: [],
  loading: false,
  error: null,
  busyIds: [],
  useSavedError: null,
  navigateToScan: false,
};

function withBusy(state: AccountsState, id: number, busy: boolean): AccountsState {
  const has = state.busyIds.includes(id);
  if (busy && !has) return { ...state, busyIds: [...state.busyIds, id] };
  if (!busy && has) return { ...state, busyIds: state.busyIds.filter((x) => x !== id) };
  return state;
}

export const accountsReducer = createReducer<AccountsState>(initialState)
  .handleAction(a.fetch.request, (state) => ({
    ...state,
    loading: true,
    error: null,
  }))
  .handleAction(a.fetch.success, (state, action) => ({
    ...state,
    loading: false,
    list: action.payload.accounts,
  }))
  .handleAction(a.fetch.failure, (state, action) => ({
    ...state,
    loading: false,
    error: action.payload.error,
  }))
  .handleAction(a.remove.request, (state, action) =>
    withBusy(state, action.payload.id, true),
  )
  .handleAction(a.remove.success, (state, action) => {
    const next = withBusy(state, action.payload.id, false);
    return {
      ...next,
      list: next.list.filter((acc) => acc.id !== action.payload.id),
    };
  })
  .handleAction(a.remove.failure, (state, action) =>
    withBusy(state, action.payload.id, false),
  )
  .handleAction(a.useSaved.request, (state, action) => {
    const next = withBusy(state, action.payload.account.id, true);
    return { ...next, useSavedError: null };
  })
  .handleAction(a.useSaved.success, (state, action) => {
    const next = withBusy(state, action.payload.account.id, false);
    return { ...next, navigateToScan: true };
  })
  .handleAction(a.useSaved.failure, (state, action) => {
    const next = withBusy(state, action.payload.account.id, false);
    return { ...next, useSavedError: action.payload.error };
  })
  .handleAction(a.navigationConsumed, (state) => ({
    ...state,
    navigateToScan: false,
  }));
