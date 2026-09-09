/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ExportDialog } from '../../src/renderer/src/components/ExportDialog.js';
import {
  inputByLabel,
  installFakeApi,
  renderWithProviders,
  type FakeApi,
} from './_helpers.js';

describe('ExportDialog', () => {
  let api: FakeApi;

  beforeEach(() => {
    api = installFakeApi();
  });

  afterEach(() => {
    delete (window as Partial<Window>).api;
  });

  it("seeds the file path from the default export dir, lets the user override via Browse, and calls export.run", async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();
    api.export.getDefaultDir.mockResolvedValueOnce({ dir: '/Users/me/Downloads' });
    api.dialog.showSave.mockResolvedValueOnce({
      canceled: false,
      filePath: '/Volumes/Reports/contacts.xlsx',
    });
    api.export.run.mockResolvedValueOnce({
      ok: true,
      filePath: '/Volumes/Reports/contacts.xlsx',
      rowsExported: 7,
    });

    renderWithProviders(
      <ExportDialog open={true} onClose={onClose} onSuccess={onSuccess} onError={onError} />,
    );

    // The dialog auto-fills File path with `${defaultDir}/contact_list_<TS>.xlsx`
    // as soon as it opens — Export is enabled from the start.
    await waitFor(() => {
      const value = (inputByLabel('File path') as HTMLInputElement).value;
      expect(value).toMatch(
        /^\/Users\/me\/Downloads\/contact_list_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.xlsx$/,
      );
    });
    expect(screen.getByRole('button', { name: /^Export$/ })).toBeEnabled();

    // Browse icon-button overrides the path.
    fireEvent.click(screen.getByRole('button', { name: /browse/i }));
    await waitFor(() => {
      expect(api.dialog.showSave).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(inputByLabel('File path')).toHaveValue(
        '/Volumes/Reports/contacts.xlsx',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    await waitFor(() => {
      expect(api.export.run).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(expect.stringContaining('7 rows'));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('reports errors via onError', async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    api.export.getDefaultDir.mockResolvedValueOnce({ dir: '/tmp' });
    api.export.run.mockRejectedValueOnce(new Error('disk full'));

    renderWithProviders(
      <ExportDialog open={true} onClose={vi.fn()} onSuccess={onSuccess} onError={onError} />,
    );

    // Wait for the auto-seeded path before overriding manually.
    await waitFor(() =>
      expect((inputByLabel('File path') as HTMLInputElement).value).not.toBe(''),
    );
    fireEvent.change(inputByLabel('File path'), {
      target: { value: '/tmp/x.xlsx' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
