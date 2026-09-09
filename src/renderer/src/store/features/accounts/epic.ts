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
import * as connection from '../connection/actions.js';
import {
  connectSavedAccount,
  deleteAccount,
  listAccounts,
} from '../../../ipc-client.js';

export const fetchAccountsEpic: Epic<RootAction, RootAction, RootState> = (action$) =>
  action$.pipe(
    filter(isActionOf(actions.fetch.request)),
    mergeMap(() =>
      from(listAccounts()).pipe(
        map((accounts) => actions.fetch.success({ accounts })),
        catchError((err: unknown) =>
          of(
            actions.fetch.failure({
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
        ),
      ),
    ),
  );

export const deleteAccountEpic: Epic<RootAction, RootAction, RootState> = (action$) =>
  action$.pipe(
    filter(isActionOf(actions.remove.request)),
    mergeMap((action) =>
      from(deleteAccount(action.payload.id)).pipe(
        map(() => actions.remove.success({ id: action.payload.id })),
        catchError((err: unknown) =>
          of(
            actions.remove.failure({
              id: action.payload.id,
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
        ),
      ),
    ),
  );

export const useSavedAccountEpic: Epic<RootAction, RootAction, RootState> = (action$) =>
  action$.pipe(
    filter(isActionOf(actions.useSaved.request)),
    mergeMap((action) => {
      const acc = action.payload.account;
      return from(connectSavedAccount(acc.id)).pipe(
        map((result) =>
          result.ok
            ? actions.useSaved.success({ account: acc })
            : actions.useSaved.failure({ account: acc, error: result.error }),
        ),
        catchError((err: unknown) =>
          of(
            actions.useSaved.failure({
              account: acc,
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
        ),
      );
    }),
  );

// On useSaved.failure, prefill the connect form so the user only has to
// retype the password — same UX as the bootstrap "needs credentials" branch.
export const useSavedPrefillEpic: Epic<RootAction, RootAction, RootState> = (action$) =>
  action$.pipe(
    filter(isActionOf(actions.useSaved.failure)),
    map((action) => {
      const acc = action.payload.account;
      if (acc.protocol === null || acc.port === null || acc.tls === null) {
        return connection.prefillFromAccount({
          host: acc.host,
          port: 993,
          tls: true,
          protocol: 'imap',
          username: acc.username,
          error: action.payload.error,
        });
      }
      return connection.prefillFromAccount({
        host: acc.host,
        port: acc.port,
        tls: acc.tls,
        protocol: acc.protocol,
        username: acc.username,
        error: action.payload.error,
      });
    }),
  );
