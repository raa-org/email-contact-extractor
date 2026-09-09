/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ScanScreen } from '../../src/renderer/src/routes/ScanScreen.js';
import * as session from '../../src/renderer/src/store/features/session/actions.js';
import * as scan from '../../src/renderer/src/store/features/scan/actions.js';
import {
  installFakeApi,
  renderWithProviders,
  type FakeApi,
} from './_helpers.js';

describe('ScanScreen', () => {
  let api: FakeApi;

  beforeEach(() => {
    api = installFakeApi();
    api.folders.list.mockResolvedValue({
      folders: [
        { path: 'INBOX', delimiter: '/', flags: ['\\HasNoChildren'], specialUse: '\\Inbox' },
        { path: 'Sent', delimiter: '/', flags: [], specialUse: '\\Sent' },
        { path: 'Archive', delimiter: '/', flags: [] },
      ],
    });
  });

  afterEach(() => {
    delete (window as Partial<Window>).api;
  });

  it('lists folders and lets the user select them, with Sent always locked-in', async () => {
    renderWithProviders(<ScanScreen />);
    await waitFor(() => {
      expect(api.folders.list).toHaveBeenCalled();
    });
    const list = await screen.findByLabelText('folder list');
    expect(within(list).getByText('INBOX')).toBeInTheDocument();
    expect(within(list).getByText('Sent')).toBeInTheDocument();

    // Sent's checkbox is permanently disabled — strict-scope means the
    // pipeline can't see outbound messages without Sent in scope, so we
    // refuse to let the user uncheck it (in either direction mode).
    const sentRow = within(list).getByText('Sent').closest('li')!;
    const sentCheckbox = within(sentRow as HTMLElement).getByRole('checkbox') as HTMLInputElement;
    expect(sentCheckbox.disabled).toBe(true);
    expect(sentCheckbox.checked).toBe(true);

    // Initial state: all 3 folders selected → toggle button reads
    // "Unselect all" because count == folders.length.
    fireEvent.click(screen.getByRole('button', { name: /^unselect all$/i }));
    const checked1 = within(list)
      .getAllByRole('checkbox')
      .filter((c) => (c as HTMLInputElement).checked);
    // Snap-back keeps Sent checked → 1 selected, not 0.
    expect(checked1).toHaveLength(1);
    expect(sentCheckbox.checked).toBe(true);

    // With 1/3 selected, toggle now reads "Select all" → re-selects all 3.
    fireEvent.click(screen.getByRole('button', { name: /^select all$/i }));
    const checked2 = within(list)
      .getAllByRole('checkbox')
      .filter((c) => (c as HTMLInputElement).checked);
    expect(checked2).toHaveLength(3);

    // "Inbox only" sets selection to ['INBOX'], snap-back upgrades to
    // ['INBOX','Sent'] → 2 selected. Button flips back to "Select all".
    fireEvent.click(screen.getByRole('button', { name: /inbox only/i }));
    const checked3 = within(list)
      .getAllByRole('checkbox')
      .filter((c) => (c as HTMLInputElement).checked);
    expect(checked3).toHaveLength(2);
    expect(sentCheckbox.checked).toBe(true);
    expect(screen.getByRole('button', { name: /^select all$/i })).toBeInTheDocument();
  });

  it('lets the user add and remove a chip in the Exclude domains filter', async () => {
    renderWithProviders(<ScanScreen />);
    await screen.findByLabelText('folder list');
    // ChipListInput uses aria-label = the full filter title; getByLabelText
    // resolves that to the inner <input>.
    const input = screen.getByLabelText(
      /^Exclude domains$/,
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'partner.com' } });
    // Submit via Enter — avoids ambiguity from the four "Add" buttons on screen.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('partner.com')).toBeInTheDocument();
    await waitFor(() => {
      expect(api.scanPreferences.save).toHaveBeenCalled();
    });
  });

  it('does not persist draft text before the user commits with Add/Enter', async () => {
    renderWithProviders(<ScanScreen />);
    await screen.findByLabelText('folder list');
    const input = screen.getByLabelText(/^Include domains \(whitelist/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'draft-only.com' } });
    expect(api.scanPreferences.save).not.toHaveBeenCalled();
  });

  it('persists direction mode and parse bodies toggles immediately', async () => {
    renderWithProviders(<ScanScreen />);
    await screen.findByLabelText('folder list');

    fireEvent.click(screen.getByRole('radio', { name: /Bi-directional/i }));
    await waitFor(() => {
      expect(api.scanPreferences.save).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            version: 1,
            filters: expect.objectContaining({ directionMode: 'off' }),
          }),
        }),
      );
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /Parse message bodies/i }));
    await waitFor(() => {
      expect(api.scanPreferences.save).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            filters: expect.objectContaining({ parseBodies: false }),
          }),
        }),
      );
    });
  });

  it('persists committed min-messages value and ignores invalid intermediate value', async () => {
    renderWithProviders(<ScanScreen />);
    await screen.findByLabelText('folder list');

    const input = screen.getByLabelText(/Min messages total/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    await waitFor(() => {
      expect(api.scanPreferences.save).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            filters: expect.objectContaining({ minMessages: 5 }),
          }),
        }),
      );
    });

    const callCount = api.scanPreferences.save.mock.calls.length;
    fireEvent.change(input, { target: { value: '0' } });
    expect(api.scanPreferences.save).toHaveBeenCalledTimes(callCount);
  });

  it('hydrates filters on account selection and falls back to defaults when none exist', async () => {
    const prefA = {
      version: 1 as const,
      filters: {
        includeDomains: ['a.com'],
        excludeDomains: ['x.com'],
        automationLocalParts: ['noreply'],
        includeWordsInbound: ['invoice'],
        excludeWordsInbound: [],
        includeWordsOutbound: [],
        excludeWordsOutbound: ['unsubscribe'],
        directionMode: 'one' as const,
        minMessages: 4,
        parseBodies: false,
      },
    };
    api.scanPreferences.get.mockResolvedValueOnce({ preferences: prefA });
    api.scanPreferences.get.mockResolvedValueOnce({ preferences: null });

    const { store } = renderWithProviders(<ScanScreen />);
    await screen.findByLabelText('folder list');

    store.dispatch(
      session.setActive({
        username: 'first@example.com',
        host: 'mail.example.com',
      }) as never,
    );

    await waitFor(() => {
      const state = store.getState() as { scan: { includeDomains: readonly string[]; minMessages: number; directionMode: string } };
      expect(state.scan.includeDomains).toEqual(['a.com']);
      expect(state.scan.minMessages).toBe(4);
      expect(state.scan.directionMode).toBe('one');
    });

    store.dispatch(
      session.setActive({
        username: 'second@example.com',
        host: 'mail.example.com',
      }) as never,
    );

    await waitFor(() => {
      const state = store.getState() as { scan: { includeDomains: readonly string[]; minMessages: number; directionMode: string } };
      expect(state.scan.includeDomains).toEqual([]);
      expect(state.scan.minMessages).toBe(2);
      expect(state.scan.directionMode).toBe('bi');
    });
    expect(api.scanPreferences.get).toHaveBeenCalledTimes(2);
  });

  it('Reset Filters restores the factory defaults', async () => {
    renderWithProviders(<ScanScreen />);
    await screen.findByLabelText('folder list');
    const input = screen.getByLabelText(
      /^Include domains \(whitelist/,
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'acme.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('acme.com')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /reset filters/i }));
    // excludeDomains has no factory default — the user's own domains are
    // deployment-specific — so reset clears the list entirely.
    expect(screen.queryByText('acme.com')).not.toBeInTheDocument();
    expect(screen.getByText('support')).toBeInTheDocument();
    await waitFor(() => {
      expect(api.scanPreferences.clear).toHaveBeenCalledTimes(1);
    });
  });

  it('includes automation local-parts in the scan start payload', async () => {
    renderWithProviders(<ScanScreen />);
    await screen.findByLabelText('folder list');
    const input = screen.getByLabelText(/^Automation local-parts$/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Robot' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    fireEvent.click(screen.getByRole('button', { name: /start scan/i }));

    await waitFor(() => {
      expect(api.scan.start).toHaveBeenCalledTimes(1);
    });
    expect(api.scan.start).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          automationLocalParts: expect.arrayContaining(['support', 'robot']),
        }),
      }),
    );
  });

  it('keeps automation local-parts expanded by default and does not save on collapse toggle', async () => {
    renderWithProviders(<ScanScreen />);
    await screen.findByLabelText('folder list');
    expect(screen.getByLabelText(/^Automation local-parts$/)).toBeInTheDocument();

    const beforeToggleCalls = api.scanPreferences.save.mock.calls.length;
    fireEvent.click(
      screen.getByRole('button', { name: /Collapse automation local-parts/i }),
    );

    await waitFor(() => {
      expect(screen.queryByLabelText(/^Automation local-parts$/)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/\d+ local-parts/i)).toBeInTheDocument();
    expect(api.scanPreferences.save).toHaveBeenCalledTimes(beforeToggleCalls);

    fireEvent.click(
      screen.getByRole('button', { name: /Expand automation local-parts/i }),
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/^Automation local-parts$/)).toBeInTheDocument();
    });
    expect(api.scanPreferences.save).toHaveBeenCalledTimes(beforeToggleCalls);
  });

  it('shows empty automation summary when no local-parts are configured', async () => {
    const { store } = renderWithProviders(<ScanScreen />);
    await screen.findByLabelText('folder list');

    store.dispatch(scan.setAutomationLocalParts([]) as never);
    fireEvent.click(
      screen.getByRole('button', { name: /Collapse automation local-parts/i }),
    );

    expect(screen.getByText('No automation local-parts')).toBeInTheDocument();
  });
});
