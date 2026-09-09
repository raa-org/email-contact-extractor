/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ContactMessagesDialog } from '../../src/renderer/src/routes/ContactMessagesDialog.js';
import { installFakeApi, renderWithProviders, type FakeApi } from './_helpers.js';

describe('ContactMessagesDialog', () => {
  let api: FakeApi;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    api = installFakeApi();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    delete (window as Partial<Window>).api;
  });

  it("copies the row's Subject to the clipboard when the subject cell is clicked", async () => {
    api.messages.forAddress.mockResolvedValueOnce({
      rows: [
        {
          folder: 'INBOX',
          uid: 42,
          dateUtc: '2026-01-01T10:00:00.000Z',
          subject: 'Quarterly review attached',
          direction: 'in',
          fromAddr: 'partner@acme.com',
          fromName: 'Partner',
          hasListUnsubscribe: false,
          hasListId: false,
          hasInlineUnsubscribe: false,
          autoSubmitted: null,
          precedence: null,
        },
      ],
      truncated: false,
    });

    renderWithProviders(
      <ContactMessagesDialog email="partner@acme.com" onClose={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByText('partner@acme.com')).toBeInTheDocument(),
    );

    const copyTarget = await screen.findByRole('button', { name: /copy subject/i });
    fireEvent.click(copyTarget);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('Quarterly review attached');
    });
  });
});
