/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { from, of } from 'rxjs';
import { catchError, filter, mergeMap, map, tap } from 'rxjs/operators';
import type { Epic } from 'redux-observable';
import { isActionOf } from 'typesafe-actions';
import type { RootAction, RootState } from '../../index.js';
import * as actions from './actions.js';
import { testConnection } from '../../../ipc-client.js';

export const testConnectionEpic: Epic<RootAction, RootAction, RootState> = (action$) =>
  action$.pipe(
    filter(isActionOf(actions.test.request)),
    tap((action) => {
      // eslint-disable-next-line no-console
      console.log(
        `[renderer] dispatching test.request protocol=${action.payload.protocol} host=${action.payload.host}:${action.payload.port} rememberMe=${action.payload.rememberMe}`,
      );
    }),
    mergeMap((action) => {
      const { rememberMe, ...creds } = action.payload;
      return from(testConnection(creds, rememberMe)).pipe(
        tap((result) => {
          // eslint-disable-next-line no-console
          console.log('[renderer] test result', result);
        }),
        map((result) =>
          result.ok
            ? actions.test.success({ capabilities: result.capabilities })
            : actions.test.failure({ error: result.error }),
        ),
        catchError((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error('[renderer] testConnection threw', err);
          return of(
            actions.test.failure({
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }),
      );
    }),
  );
