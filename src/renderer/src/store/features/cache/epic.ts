/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { from, of } from 'rxjs';
import { catchError, filter, mergeMap, map } from 'rxjs/operators';
import type { Epic } from 'redux-observable';
import { isActionOf } from 'typesafe-actions';
import type { RootAction, RootState } from '../../index.js';
import * as actions from './actions.js';
import { resetCache } from '../../../ipc-client.js';

// Drives the cache.reset IPC off the action stream so the click handler
// can return immediately. The handler dispatches reset.request, navigates
// away from the stale-data screen synchronously, and the epic owns the
// async wipe + success/failure dispatch.
export const resetEpic: Epic<RootAction, RootAction, RootState> = (action$) =>
  action$.pipe(
    filter(isActionOf(actions.reset.request)),
    mergeMap(() =>
      from(resetCache()).pipe(
        map(() => actions.reset.success()),
        catchError((err: unknown) =>
          of(
            actions.reset.failure({
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
        ),
      ),
    ),
  );
