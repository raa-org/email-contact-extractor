/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { configureStore, combineReducers } from '@reduxjs/toolkit';
import { combineEpics, createEpicMiddleware } from 'redux-observable';
import type { ActionType, StateType } from 'typesafe-actions';
import { connectionReducer } from './features/connection/reducer.js';
import * as connectionActions from './features/connection/actions.js';
import { testConnectionEpic } from './features/connection/epic.js';
import { scanReducer } from './features/scan/reducer.js';
import * as scanActions from './features/scan/actions.js';
import {
  cancelEpic,
  clearFilterPreferencesEpic,
  fetchFoldersEpic,
  loadFilterPreferencesEpic,
  progressEpic,
  saveFilterPreferencesEpic,
  snapshotEpic,
  startEpic,
} from './features/scan/epic.js';
import { contactsReducer } from './features/contacts/reducer.js';
import * as contactsActions from './features/contacts/actions.js';
import { fetchEpic } from './features/contacts/epic.js';
import { bootstrapReducer } from './features/bootstrap/reducer.js';
import * as bootstrapActions from './features/bootstrap/actions.js';
import { bootstrapEpic, bootstrapPrefillEpic } from './features/bootstrap/epic.js';
import { accountsReducer } from './features/accounts/reducer.js';
import * as accountsActions from './features/accounts/actions.js';
import {
  deleteAccountEpic,
  fetchAccountsEpic,
  useSavedAccountEpic,
  useSavedPrefillEpic,
} from './features/accounts/epic.js';
import { sessionReducer } from './features/session/reducer.js';
import * as sessionActions from './features/session/actions.js';
import { cacheReducer } from './features/cache/reducer.js';
import * as cacheActions from './features/cache/actions.js';
import { resetEpic as cacheResetEpic } from './features/cache/epic.js';

const rootReducer = combineReducers({
  connection: connectionReducer,
  scan: scanReducer,
  contacts: contactsReducer,
  bootstrap: bootstrapReducer,
  accounts: accountsReducer,
  session: sessionReducer,
  cache: cacheReducer,
});

export type RootState = StateType<typeof rootReducer>;
export type RootAction =
  | ActionType<typeof connectionActions>
  | ActionType<typeof scanActions>
  | ActionType<typeof contactsActions>
  | ActionType<typeof bootstrapActions>
  | ActionType<typeof accountsActions>
  | ActionType<typeof sessionActions>
  | ActionType<typeof cacheActions>;

const rootEpic = combineEpics(
  testConnectionEpic,
  fetchFoldersEpic,
  startEpic,
  cancelEpic,
  progressEpic,
  snapshotEpic,
  loadFilterPreferencesEpic,
  saveFilterPreferencesEpic,
  clearFilterPreferencesEpic,
  fetchEpic,
  bootstrapEpic,
  bootstrapPrefillEpic,
  fetchAccountsEpic,
  deleteAccountEpic,
  useSavedAccountEpic,
  useSavedPrefillEpic,
  cacheResetEpic,
);

export function createStore(): ReturnType<typeof configureStore> {
  const epicMiddleware = createEpicMiddleware<RootAction, RootAction, RootState>();
  const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefault) => getDefault({ thunk: false }).concat(epicMiddleware),
  });
  epicMiddleware.run(rootEpic as never);
  return store;
}

declare module 'typesafe-actions' {
  interface Types {
    RootAction: RootAction;
    RootState: RootState;
  }
}
