/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ConnectScreen } from '../../src/renderer/src/routes/ConnectScreen.js';
import {
  inputByLabel,
  installFakeApi,
  renderWithProviders,
  type FakeApi,
} from './_helpers.js';

describe('ConnectScreen', () => {
  let api: FakeApi;

  beforeEach(() => {
    api = installFakeApi();
  });

  afterEach(() => {
    delete (window as Partial<Window>).api;
  });

  function setupForm(): void {
    // Host has to be typed: the only shipped preset is "Custom…", which
    // starts empty, so the form is incomplete until the user names a server.
    fireEvent.change(inputByLabel('Host'), {
      target: { value: 'imap.example.com' },
    });
    fireEvent.change(inputByLabel('Username'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(inputByLabel('Password'), {
      target: { value: 'pwd' },
    });
  }

  it('disables Test connection until required fields are filled', () => {
    renderWithProviders(<ConnectScreen />);
    expect(screen.getByRole('button', { name: /^Test connection$/i })).toBeDisabled();
    setupForm();
    expect(screen.getByRole('button', { name: /^Test connection$/i })).toBeEnabled();
  });

  it('keeps Continue disabled until Test succeeds', async () => {
    renderWithProviders(<ConnectScreen />);
    setupForm();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /^Test connection$/i }));

    await waitFor(() => {
      expect(api.imap.testConnection).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
    });
    expect(screen.getByRole('status')).toHaveTextContent(/successful/i);
  });

  it('shows the typed error when Test fails', async () => {
    api.imap.testConnection.mockResolvedValueOnce({ ok: false, error: 'auth failed' });
    renderWithProviders(<ConnectScreen />);
    setupForm();
    fireEvent.click(screen.getByRole('button', { name: /^Test connection$/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/auth failed/i);
    });
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('clears the password from Redux state after a successful test', async () => {
    const { store } = renderWithProviders(<ConnectScreen />);
    setupForm();
    fireEvent.click(screen.getByRole('button', { name: /^Test connection$/i }));
    await waitFor(() => {
      expect(api.imap.testConnection).toHaveBeenCalled();
    });
    await waitFor(() => {
      const state = store.getState() as { connection: { form: { password: string } } };
      expect(state.connection.form.password).toBe('');
    });
  });
});
