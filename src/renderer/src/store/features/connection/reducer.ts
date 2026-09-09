/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { createReducer } from 'typesafe-actions';
import * as a from './actions.js';

export interface ServerPreset {
  readonly id: string;
  readonly label: string;
  readonly host: string;
  readonly imapPort: number;
  readonly tls: boolean;
}

// No provider shortcuts ship by default: which servers are worth listing is
// deployment-specific, and a preset would imply a level of support the app
// does not have (sign-in is IMAP username + password, never OAuth). Every
// mailbox is reached by typing its host into the Custom entry.
export const SERVER_PRESETS: readonly ServerPreset[] = [
  {
    id: 'custom',
    label: 'Custom…',
    host: '',
    imapPort: 993,
    tls: true,
  },
];

export function defaultPortFor(preset: ServerPreset): number {
  return preset.imapPort;
}

export interface ConnectionState {
  readonly form: a.ConnectionFormState;
  readonly testing: boolean;
  readonly testStatus: 'idle' | 'success' | 'error';
  readonly error: string | null;
  readonly capabilities: readonly string[];
}

const initialPreset = SERVER_PRESETS[0]!;

export const initialState: ConnectionState = {
  form: {
    presetId: initialPreset.id,
    protocol: 'imap',
    host: initialPreset.host,
    port: defaultPortFor(initialPreset),
    tls: initialPreset.tls,
    username: '',
    password: '',
    rememberMe: true,
  },
  testing: false,
  testStatus: 'idle',
  error: null,
  capabilities: [],
};

function presetIdForHost(host: string): string {
  const match = SERVER_PRESETS.find((p) => p.host === host);
  return match ? match.id : 'custom';
}

export const connectionReducer = createReducer<ConnectionState>(initialState)
  .handleAction(a.updateForm, (state, action) => ({
    ...state,
    form: { ...state.form, ...action.payload },
    testStatus: 'idle',
    error: null,
  }))
  .handleAction(a.prefillFromAccount, (state, action) => {
    const { host, port, tls, protocol, username, error } = action.payload;
    return {
      ...state,
      form: {
        ...state.form,
        presetId: presetIdForHost(host),
        host,
        port,
        tls,
        protocol,
        username,
        password: '',
        // Preserve the user's last remember-me choice; default to true if
        // this is the very first paint.
        rememberMe: state.form.rememberMe,
      },
      testing: false,
      testStatus: error !== undefined ? 'error' : 'idle',
      error: error ?? null,
    };
  })
  .handleAction(a.test.request, (state) => ({
    ...state,
    testing: true,
    error: null,
    testStatus: 'idle',
  }))
  .handleAction(a.test.success, (state, action) => ({
    ...state,
    testing: false,
    testStatus: 'success',
    capabilities: action.payload.capabilities,
    form: { ...state.form, password: '' },
  }))
  .handleAction(a.test.failure, (state, action) => ({
    ...state,
    testing: false,
    testStatus: 'error',
    error: action.payload.error,
  }))
  .handleAction(a.reset, () => initialState);
