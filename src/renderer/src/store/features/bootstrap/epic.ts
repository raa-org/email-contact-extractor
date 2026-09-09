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
import * as connection from '../connection/actions.js';
import { connectSavedAccount, getLastAccount } from '../../../ipc-client.js';
import type { AccountSummary } from '../../../../../shared/ipc-contracts.js';

export const bootstrapEpic: Epic<RootAction, RootAction, RootState> = (action$) =>
  action$.pipe(
    filter(isActionOf(actions.start)),
    tap(() => {
      // eslint-disable-next-line no-console
      console.log('[renderer] bootstrap.start');
    }),
    mergeMap(() =>
      from(getLastAccount()).pipe(
        mergeMap((account) => {
          if (!account || !account.hasPassword) {
            return of(actions.done({ kind: 'empty' }));
          }
          return from(connectSavedAccount(account.id)).pipe(
            map((result) =>
              result.ok
                ? actions.done({ kind: 'connected', account })
                : actions.done({
                    kind: 'needsCredentials',
                    account,
                    error: result.error,
                  }),
            ),
          );
        }),
        catchError((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error('[renderer] bootstrap failed', err);
          return of(actions.done({ kind: 'empty' }));
        }),
      ),
    ),
  );

// When bootstrap completes with a needs-credentials outcome we have the
// account metadata in hand; prefill the connect form so the user only has
// to retype the password (or pick a different saved account).
export const bootstrapPrefillEpic: Epic<RootAction, RootAction, RootState> = (action$) =>
  action$.pipe(
    filter(isActionOf(actions.done)),
    filter(
      (a): a is ReturnType<typeof actions.done> & {
        payload: { kind: 'needsCredentials'; account: AccountSummary; error: string };
      } => a.payload.kind === 'needsCredentials',
    ),
    map((a) => {
      const acc = a.payload.account;
      // The repo guarantees these are non-null when hasPassword=true is
      // surfaced through getLastAccount, but we narrow defensively so
      // bootstrap can never produce a half-filled form.
      if (acc.protocol === null || acc.port === null || acc.tls === null) {
        return connection.prefillFromAccount({
          host: acc.host,
          port: 993,
          tls: true,
          protocol: 'imap',
          username: acc.username,
          error: a.payload.error,
        });
      }
      return connection.prefillFromAccount({
        host: acc.host,
        port: acc.port,
        tls: acc.tls,
        protocol: acc.protocol,
        username: acc.username,
        error: a.payload.error,
      });
    }),
  );
