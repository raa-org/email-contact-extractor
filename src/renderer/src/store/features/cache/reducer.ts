/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { createReducer } from 'typesafe-actions';
import * as a from './actions.js';

// `lastResult` toggles to 'success' / 'error' when an attempt completes;
// the AppHeader subscribes via useEffect to surface a toast and then
// resets the flag (via cache/reset/request on the next attempt). The
// flag is intentionally a discriminator rather than a counter so a
// repeated identical result still re-fires the effect — useEffect would
// skip it otherwise.
export interface CacheState {
  readonly resetting: boolean;
  readonly lastResult: 'success' | 'error' | null;
  readonly error: string | null;
  // Monotonic counter incremented on every success/failure so the
  // AppHeader's useEffect dependency array picks up "another result
  // arrived" even when it's identical to the previous one.
  readonly resultSeq: number;
}

export const initialState: CacheState = {
  resetting: false,
  lastResult: null,
  error: null,
  resultSeq: 0,
};

export const cacheReducer = createReducer<CacheState>(initialState)
  .handleAction(a.reset.request, (state) => ({
    ...state,
    resetting: true,
    lastResult: null,
    error: null,
  }))
  .handleAction(a.reset.success, (state) => ({
    ...state,
    resetting: false,
    lastResult: 'success',
    error: null,
    resultSeq: state.resultSeq + 1,
  }))
  .handleAction(a.reset.failure, (state, action) => ({
    ...state,
    resetting: false,
    lastResult: 'error',
    error: action.payload.error,
    resultSeq: state.resultSeq + 1,
  }));
