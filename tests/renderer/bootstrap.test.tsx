/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route, Navigate } from 'react-router';
import { BootstrapGate } from '../../src/renderer/src/components/BootstrapGate.js';
import { installFakeApi, renderWithProviders, type FakeApi } from './_helpers.js';

function ScanProbe() {
  return <div data-testid="scan-screen">scan</div>;
}
function ConnectProbe() {
  return <div data-testid="connect-screen">connect</div>;
}

function Harness() {
  return (
    <BootstrapGate>
      <Routes>
        <Route path="/" element={<Navigate to="/connect" replace />} />
        <Route path="/connect" element={<ConnectProbe />} />
        <Route path="/scan" element={<ScanProbe />} />
      </Routes>
    </BootstrapGate>
  );
}

describe('BootstrapGate', () => {
  let api: FakeApi;

  beforeEach(() => {
    api = installFakeApi();
  });

  afterEach(() => {
    delete (window as Partial<Window>).api;
  });

  it('shows the splash, then routes to /connect when no saved account exists', async () => {
    api.accounts.getLast.mockResolvedValueOnce({ account: null });
    renderWithProviders(<Harness />);
    expect(screen.getByRole('status', { name: /restoring/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('connect-screen')).toBeInTheDocument();
    });
    expect(api.accounts.getLast).toHaveBeenCalled();
    expect(api.imap.connectSaved).not.toHaveBeenCalled();
  });

  it('auto-connects with the saved account and routes to /scan', async () => {
    api.accounts.getLast.mockResolvedValueOnce({
      account: {
        id: 7,
        host: 'imap.example.com',
        username: 'u@example.com',
        protocol: 'imap',
        port: 993,
        tls: true,
        hasPassword: true,
        lastUsedAt: 1_700_000_000_000,
      },
    });
    api.imap.connectSaved.mockResolvedValueOnce({ ok: true, capabilities: ['IMAP4rev1'] });
    const { store } = renderWithProviders(<Harness />);
    await waitFor(() => {
      expect(screen.getByTestId('scan-screen')).toBeInTheDocument();
    });
    expect(api.imap.connectSaved).toHaveBeenCalledWith({ accountId: 7 });
    expect(api.scanPreferences.get).toHaveBeenCalledTimes(1);
    const state = store.getState() as { scan: { includeDomains: readonly string[] } };
    expect(state.scan.includeDomains).toEqual([]);
  });

  it('falls back to /connect with the form prefilled when auto-connect fails', async () => {
    api.accounts.getLast.mockResolvedValueOnce({
      account: {
        id: 9,
        host: 'mail.example.com',
        username: 'me@example.com',
        protocol: 'imap',
        port: 993,
        tls: true,
        hasPassword: true,
        lastUsedAt: 1_700_000_000_000,
      },
    });
    api.imap.connectSaved.mockResolvedValueOnce({ ok: false, error: 'auth failed' });
    const { store } = renderWithProviders(<Harness />);
    await waitFor(() => {
      expect(screen.getByTestId('connect-screen')).toBeInTheDocument();
    });
    const state = store.getState() as {
      connection: { form: { host: string; username: string }; error: string | null };
    };
    expect(state.connection.form.host).toBe('mail.example.com');
    expect(state.connection.form.username).toBe('me@example.com');
    expect(state.connection.error).toBe('auth failed');
  });
});
