/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { createAsyncAction, createAction } from 'typesafe-actions';
import type { ContactRow } from '../../../../../shared/domain.js';

export const fetch = createAsyncAction(
  'contacts/fetch/request',
  'contacts/fetch/success',
  'contacts/fetch/failure',
)<
  { query?: string; offset: number; limit: number },
  { rows: readonly ContactRow[]; total: number },
  { error: string }
>();

export const setQuery = createAction('contacts/setQuery')<string>();
export const reset = createAction('contacts/reset')();
