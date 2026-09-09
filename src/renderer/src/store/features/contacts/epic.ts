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
import { listContacts } from '../../../ipc-client.js';

export const fetchEpic: Epic<RootAction, RootAction, RootState> = (action$) =>
  action$.pipe(
    filter(isActionOf(actions.fetch.request)),
    mergeMap((action) => {
      const filterArg: { query?: string } = {};
      if (action.payload.query) filterArg.query = action.payload.query;
      return from(
        listContacts(filterArg, {
          offset: action.payload.offset,
          limit: action.payload.limit,
        }),
      ).pipe(
        map((res) => actions.fetch.success({ rows: res.rows, total: res.total })),
        catchError((err: unknown) =>
          of(
            actions.fetch.failure({
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
        ),
      );
    }),
  );
