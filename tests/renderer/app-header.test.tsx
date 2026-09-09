/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router';
import { AppHeader } from '../../src/renderer/src/components/AppHeader.js';
import * as session from '../../src/renderer/src/store/features/session/actions.js';
import * as bootstrap from '../../src/renderer/src/store/features/bootstrap/actions.js';
import * as scan from '../../src/renderer/src/store/features/scan/actions.js';
import { installFakeApi, renderWithProviders } from './_helpers.js';

function Harness() {
  return (
    <>
      <AppHeader />
      <Routes>
        <Route path="/scan" element={<div data-testid="scan-screen">scan</div>} />
        <Route path="/connect" element={<div data-testid="connect-screen">connect</div>} />
      </Routes>
    </>
  );
}

describe('AppHeader', () => {
  beforeEach(() => {
    installFakeApi();
  });

  afterEach(() => {
    delete (window as Partial<Window>).api;
  });

  it('does not render while bootstrap is still pending', () => {
    renderWithProviders(<Harness />, { initialEntries: ['/scan'] });
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
  });

  it('hides itself on /connect even after bootstrap finishes', async () => {
    const { store } = renderWithProviders(<Harness />, { initialEntries: ['/connect'] });
    act(() => {
      store.dispatch(bootstrap.done({ kind: 'empty' }) as never);
    });
    await waitFor(() => {
      expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    });
  });

  it('renders the active username and routes back to /connect on Switch', async () => {
    const { store } = renderWithProviders(<Harness />, { initialEntries: ['/scan'] });
    act(() => {
      store.dispatch(bootstrap.done({ kind: 'empty' }) as never);
      store.dispatch(
        session.setActive({
          username: 'me@example.com',
          host: 'mail.example.com',
        }) as never,
      );
    });
    await waitFor(() => {
      expect(screen.getByText(/me@example\.com/)).toBeInTheDocument();
    });
    expect(screen.getByText(/mail\.example\.com/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /switch account/i }));
    await waitFor(() => {
      expect(screen.getByTestId('connect-screen')).toBeInTheDocument();
    });
  });

  it('Reset Cache clears cache only and keeps current filters intact', async () => {
    const api = installFakeApi();
    const { store } = renderWithProviders(<Harness />, { initialEntries: ['/scan'] });
    act(() => {
      store.dispatch(bootstrap.done({ kind: 'empty' }) as never);
      store.dispatch(
        session.setActive({
          username: 'me@example.com',
          host: 'mail.example.com',
        }) as never,
      );
    });

    await waitFor(() => {
      expect(api.scanPreferences.get).toHaveBeenCalledTimes(1);
    });

    act(() => {
      store.dispatch(scan.setIncludeDomains(['acme.com']) as never);
    });
    const saveCallsBeforeReset = api.scanPreferences.save.mock.calls.length;
    const clearCallsBeforeReset = api.scanPreferences.clear.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /reset cache/i }));
    fireEvent.click(screen.getByRole('button', { name: /^reset cache$/i }));

    await waitFor(() => {
      expect(api.cache.reset).toHaveBeenCalledTimes(1);
    });
    expect((store.getState() as { scan: { includeDomains: readonly string[] } }).scan.includeDomains).toEqual([
      'acme.com',
    ]);
    expect(api.scanPreferences.clear).toHaveBeenCalledTimes(clearCallsBeforeReset);
    expect(api.scanPreferences.save).toHaveBeenCalledTimes(saveCallsBeforeReset);
  });
});
