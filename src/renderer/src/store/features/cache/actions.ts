/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { createAsyncAction } from 'typesafe-actions';

// Side-effect-only async action: the request fires the IPC that wipes
// SQLite, success/failure flip the slice's transient flags so a UI toast
// can react. There's no payload — the cache is always wiped wholesale.
export const reset = createAsyncAction(
  'cache/reset/request',
  'cache/reset/success',
  'cache/reset/failure',
)<undefined, undefined, { error: string }>();
