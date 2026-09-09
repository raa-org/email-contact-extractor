/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { ResultsScreen } from '../../src/renderer/src/routes/ResultsScreen.js';
import { ScanOptions } from '../../src/shared/domain.js';
import * as scanActions from '../../src/renderer/src/store/features/scan/actions.js';
import {
  inputByLabel,
  installFakeApi,
  renderWithProviders,
  type FakeApi,
} from './_helpers.js';

const sampleRows = [
  {
    email: 'partner1@acme.com',
    firstSeenUtc: '2024-01-01T10:00:00.000Z',
    lastSeenUtc: '2024-12-31T10:00:00.000Z',
    countIn: 10,
    countOut: 5,
    total: 15,
    subjectsSample: ['Project update'],
    displayNames: ['Partner One'],
  },
  {
    email: 'partner2@beta.io',
    firstSeenUtc: '2024-02-01T10:00:00.000Z',
    lastSeenUtc: '2024-11-30T10:00:00.000Z',
    countIn: 4,
    countOut: 4,
    total: 8,
    subjectsSample: ['Quarterly review'],
    displayNames: ['Partner Two'],
  },
];

describe('ResultsScreen', () => {
  let api: FakeApi;

  beforeEach(() => {
    api = installFakeApi();
    api.contacts.list.mockResolvedValue({ rows: sampleRows, total: sampleRows.length });
  });

  afterEach(() => {
    delete (window as Partial<Window>).api;
  });

  it('fetches contacts on mount and filters by the search box', async () => {
    renderWithProviders(<ResultsScreen />);
    await waitFor(() => {
      expect(api.contacts.list).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText('partner1@acme.com')).toBeInTheDocument();
    });

    fireEvent.change(inputByLabel('Search'), { target: { value: 'beta' } });

    await waitFor(() => {
      expect(screen.queryByText('partner1@acme.com')).not.toBeInTheDocument();
    });
    expect(screen.getByText('partner2@beta.io')).toBeInTheDocument();
  });

  it('renders streamed snapshot contacts append-only and shows a scan-in-progress chip', async () => {
    // The fallback fetch fires once on cold mount (idle state). That's
    // covered by the test above; here we focus on the streaming flow.
    api.contacts.list.mockClear();
    const { store } = renderWithProviders(<ResultsScreen />);
    api.contacts.list.mockClear();

    act(() => {
      store.dispatch(
        scanActions.start.request(ScanOptions.parse({})) as never,
      );
      store.dispatch(
        scanActions.snapshotAppended({
          runId: 'r1',
          contacts: [sampleRows[0]!],
        }) as never,
      );
    });
    await waitFor(() => {
      expect(screen.getByText(/scan in progress/i)).toBeInTheDocument();
    });
    expect(screen.getByText('partner1@acme.com')).toBeInTheDocument();
    // No further paginated fetches once streaming has started.
    expect(api.contacts.list).not.toHaveBeenCalled();

    act(() => {
      store.dispatch(
        scanActions.snapshotAppended({
          runId: 'r1',
          contacts: [sampleRows[1]!],
        }) as never,
      );
    });
    await waitFor(() => {
      expect(screen.getByText('partner2@beta.io')).toBeInTheDocument();
    });
    // Earlier rows still visible — append-only.
    expect(screen.getByText('partner1@acme.com')).toBeInTheDocument();

    act(() => {
      store.dispatch(
        scanActions.start.success({ runId: 'r1', contactsCount: 2 }) as never,
      );
    });
    await waitFor(() => {
      expect(screen.getByText(/scan complete/i)).toBeInTheDocument();
    });
  });
});
