/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { type ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { Provider } from 'react-redux';
import { combineEpics, createEpicMiddleware } from 'redux-observable';
import { configureStore, combineReducers } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router';
import { vi, type Mock } from 'vitest';
import { connectionReducer } from '../../src/renderer/src/store/features/connection/reducer.js';
import { scanReducer } from '../../src/renderer/src/store/features/scan/reducer.js';
import { contactsReducer } from '../../src/renderer/src/store/features/contacts/reducer.js';
import { bootstrapReducer } from '../../src/renderer/src/store/features/bootstrap/reducer.js';
import { accountsReducer } from '../../src/renderer/src/store/features/accounts/reducer.js';
import { sessionReducer } from '../../src/renderer/src/store/features/session/reducer.js';
import { cacheReducer } from '../../src/renderer/src/store/features/cache/reducer.js';
import { resetEpic as cacheResetEpic } from '../../src/renderer/src/store/features/cache/epic.js';
import { testConnectionEpic } from '../../src/renderer/src/store/features/connection/epic.js';
import {
  cancelEpic,
  clearFilterPreferencesEpic,
  fetchFoldersEpic,
  loadFilterPreferencesEpic,
  saveFilterPreferencesEpic,
  snapshotEpic,
  startEpic,
} from '../../src/renderer/src/store/features/scan/epic.js';
import { fetchEpic } from '../../src/renderer/src/store/features/contacts/epic.js';
import {
  bootstrapEpic,
  bootstrapPrefillEpic,
} from '../../src/renderer/src/store/features/bootstrap/epic.js';
import {
  deleteAccountEpic,
  fetchAccountsEpic,
  useSavedAccountEpic,
  useSavedPrefillEpic,
} from '../../src/renderer/src/store/features/accounts/epic.js';

export interface FakeApi {
  ping: Mock;
  imap: { testConnection: Mock; connectSaved: Mock };
  folders: { list: Mock };
  scan: { start: Mock; cancel: Mock; onProgress: Mock; onSnapshotUpdated: Mock };
  scanPreferences: { get: Mock; save: Mock; clear: Mock };
  contacts: { list: Mock };
  messages: { forAddress: Mock };
  export: { run: Mock; getDefaultDir: Mock };
  dialog: { showSave: Mock };
  session: { disconnect: Mock };
  accounts: { list: Mock; delete: Mock; getLast: Mock };
  cache: { reset: Mock };
  app: { showLogs: Mock };
}

export function installFakeApi(): FakeApi {
  const api: FakeApi = {
    ping: vi.fn().mockResolvedValue({ message: 'pong' }),
    imap: {
      testConnection: vi.fn().mockResolvedValue({ ok: true, capabilities: [] }),
      connectSaved: vi.fn().mockResolvedValue({ ok: true, capabilities: [] }),
    },
    folders: { list: vi.fn().mockResolvedValue({ folders: [] }) },
    scan: {
      start: vi.fn().mockResolvedValue({ runId: 'r1', contactsCount: 0 }),
      cancel: vi.fn().mockResolvedValue({ ok: true }),
      onProgress: vi.fn(() => () => undefined),
      onSnapshotUpdated: vi.fn(() => () => undefined),
    },
    scanPreferences: {
      get: vi.fn().mockResolvedValue({ preferences: null }),
      save: vi.fn().mockResolvedValue({ ok: true }),
      clear: vi.fn().mockResolvedValue({ ok: true }),
    },
    contacts: {
      list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    },
    messages: {
      forAddress: vi.fn().mockResolvedValue({ rows: [], truncated: false }),
    },
    export: {
      run: vi.fn().mockResolvedValue({ ok: true, filePath: '/tmp/x.csv', rowsExported: 0 }),
      getDefaultDir: vi.fn().mockResolvedValue({ dir: '/tmp' }),
    },
    dialog: {
      showSave: vi.fn().mockResolvedValue({ canceled: false, filePath: '/tmp/x.csv' }),
    },
    session: { disconnect: vi.fn().mockResolvedValue({ ok: true }) },
    accounts: {
      list: vi.fn().mockResolvedValue({ accounts: [] }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
      getLast: vi.fn().mockResolvedValue({ account: null }),
    },
    cache: {
      reset: vi.fn().mockResolvedValue({ ok: true }),
    },
    app: {
      showLogs: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
  return api;
}

export function renderWithProviders(
  ui: ReactElement,
  { initialEntries = ['/'] }: { initialEntries?: string[] } = {},
): { result: RenderResult; store: ReturnType<typeof buildStore> } {
  const store = buildStore();
  const result = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </Provider>,
  );
  return { result, store };
}

// MUI v9 OutlinedInput renders both a real <label> and a <legend><span>...</span></legend>
// inside the notch fieldset. Both contribute to testing-library's label search,
// so getByLabelText reports "multiple elements". This helper goes through the
// real <label for=…> link and returns the associated input directly.
export function inputByLabel(label: string): HTMLInputElement {
  const labels = Array.from(document.querySelectorAll('label'));
  for (const lbl of labels) {
    const text = lbl.textContent?.trim();
    if (text !== label) continue;
    const forAttr = lbl.getAttribute('for');
    if (!forAttr) continue;
    const input = document.getElementById(forAttr);
    if (input instanceof HTMLInputElement) return input;
  }
  throw new Error(`No input element associated with label "${label}"`);
}

function buildStore() {
  const rootReducer = combineReducers({
    connection: connectionReducer,
    scan: scanReducer,
    contacts: contactsReducer,
    bootstrap: bootstrapReducer,
    accounts: accountsReducer,
    session: sessionReducer,
    cache: cacheReducer,
  });
  const epicMiddleware = createEpicMiddleware();
  const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefault) => getDefault({ thunk: false }).concat(epicMiddleware),
  });
  const rootEpic = combineEpics(
    testConnectionEpic as never,
    fetchFoldersEpic as never,
    startEpic as never,
    cancelEpic as never,
    snapshotEpic as never,
    loadFilterPreferencesEpic as never,
    saveFilterPreferencesEpic as never,
    clearFilterPreferencesEpic as never,
    fetchEpic as never,
    bootstrapEpic as never,
    bootstrapPrefillEpic as never,
    fetchAccountsEpic as never,
    deleteAccountEpic as never,
    useSavedAccountEpic as never,
    useSavedPrefillEpic as never,
    cacheResetEpic as never,
  );
  epicMiddleware.run(rootEpic);
  return store;
}
