/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { createReducer } from 'typesafe-actions';
import * as bootstrap from '../bootstrap/actions.js';
import * as accounts from '../accounts/actions.js';
import * as a from './actions.js';

export interface SessionState {
  readonly active: a.ActiveAccount | null;
}

export const initialState: SessionState = { active: null };

// Single source of truth for "who is the user currently logged in as?".
// The two automated paths (bootstrap auto-resume, click-Use on a saved
// account) populate it directly via handleAction below. The manual
// Test → Continue path dispatches setActive explicitly from ConnectScreen
// so test.success alone — which doesn't mean the user committed to that
// account yet — does not flip the header.
export const sessionReducer = createReducer<SessionState>(initialState)
  .handleAction(a.setActive, (_state, action) => ({ active: action.payload }))
  .handleAction(a.clear, () => initialState)
  .handleAction(bootstrap.done, (state, action) => {
    if (action.payload.kind !== 'connected') return state;
    return {
      active: {
        username: action.payload.account.username,
        host: action.payload.account.host,
      },
    };
  })
  .handleAction(accounts.useSaved.success, (_state, action) => ({
    active: {
      username: action.payload.account.username,
      host: action.payload.account.host,
    },
  }));
