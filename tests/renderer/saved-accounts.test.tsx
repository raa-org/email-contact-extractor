/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ConnectScreen } from '../../src/renderer/src/routes/ConnectScreen.js';
import { installFakeApi, renderWithProviders, type FakeApi } from './_helpers.js';

const ACCOUNT_A = {
  id: 1,
  host: 'imap.example.com',
  username: 'a@example.com',
  protocol: 'imap' as const,
  port: 993,
  tls: true,
  hasPassword: true,
  lastUsedAt: 1_700_000_000_000,
};

const ACCOUNT_B = {
  id: 2,
  host: 'imap.gmail.com',
  username: 'b@gmail.com',
  protocol: 'imap' as const,
  port: 993,
  tls: true,
  hasPassword: true,
  lastUsedAt: 1_700_000_010_000,
};

describe('ConnectScreen — saved accounts', () => {
  let api: FakeApi;

  beforeEach(() => {
    api = installFakeApi();
  });

  afterEach(() => {
    delete (window as Partial<Window>).api;
  });

  it('lists saved accounts on mount', async () => {
    api.accounts.list.mockResolvedValue({ accounts: [ACCOUNT_A, ACCOUNT_B] });
    renderWithProviders(<ConnectScreen />);
    expect(api.accounts.list).toHaveBeenCalled();
    const list = await screen.findByRole('list');
    expect(within(list).getByText(/a@example\.com/)).toBeInTheDocument();
    expect(within(list).getByText(/b@gmail\.com/)).toBeInTheDocument();
  });

  it('does not render the saved-accounts panel when the list is empty', async () => {
    api.accounts.list.mockResolvedValue({ accounts: [] });
    renderWithProviders(<ConnectScreen />);
    await waitFor(() => {
      expect(api.accounts.list).toHaveBeenCalled();
    });
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText(/saved accounts/i)).not.toBeInTheDocument();
  });

  it('clicking Use fires connectSaved and surfaces the failure error', async () => {
    api.accounts.list.mockResolvedValue({ accounts: [ACCOUNT_A] });
    api.imap.connectSaved.mockResolvedValueOnce({ ok: false, error: 'auth failed' });
    const { store } = renderWithProviders(<ConnectScreen />);
    const useBtn = await screen.findByRole('button', { name: /use a@example/i });
    fireEvent.click(useBtn);
    await waitFor(() => {
      expect(api.imap.connectSaved).toHaveBeenCalledWith({ accountId: ACCOUNT_A.id });
    });
    await waitFor(() => {
      const alerts = screen.queryAllByRole('alert');
      expect(alerts.some((a) => /auth failed/i.test(a.textContent ?? ''))).toBe(true);
    });
    const state = store.getState() as {
      connection: { form: { host: string; username: string }; error: string | null };
    };
    expect(state.connection.form.host).toBe(ACCOUNT_A.host);
    expect(state.connection.form.username).toBe(ACCOUNT_A.username);
    expect(state.connection.error).toBe('auth failed');
  });

  it('clicking Use on a valid account loads persisted scan preferences', async () => {
    api.accounts.list.mockResolvedValue({ accounts: [ACCOUNT_A] });
    api.imap.connectSaved.mockResolvedValueOnce({ ok: true, capabilities: ['IMAP4rev1'] });
    renderWithProviders(<ConnectScreen />);
    const useBtn = await screen.findByRole('button', { name: /use a@example/i });
    fireEvent.click(useBtn);

    await waitFor(() => {
      expect(api.imap.connectSaved).toHaveBeenCalledWith({ accountId: ACCOUNT_A.id });
    });
    await waitFor(() => {
      expect(api.scanPreferences.get).toHaveBeenCalledTimes(1);
    });
  });

  it('clicking the Forget button calls accounts.delete and removes the row', async () => {
    api.accounts.list.mockResolvedValue({ accounts: [ACCOUNT_A] });
    renderWithProviders(<ConnectScreen />);
    await screen.findByText(/a@example\.com/);
    const forgetBtn = screen.getByRole('button', { name: /forget a@example/i });
    fireEvent.click(forgetBtn);
    await waitFor(() => {
      expect(api.accounts.delete).toHaveBeenCalledWith({ id: ACCOUNT_A.id });
    });
    await waitFor(() => {
      expect(screen.queryByText(/a@example\.com/)).not.toBeInTheDocument();
    });
  });
});
