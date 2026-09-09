/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { createReducer } from 'typesafe-actions';
import * as a from './actions.js';

export interface BootstrapState {
  readonly phase: 'idle' | 'pending' | 'done';
  readonly outcome: a.BootstrapOutcome | null;
}

export const initialState: BootstrapState = {
  phase: 'idle',
  outcome: null,
};

export const bootstrapReducer = createReducer<BootstrapState>(initialState)
  .handleAction(a.start, (state) => ({ ...state, phase: 'pending', outcome: null }))
  .handleAction(a.done, (_state, action) => ({
    phase: 'done',
    outcome: action.payload,
  }));
