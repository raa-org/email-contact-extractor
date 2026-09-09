/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { EMPTY, Observable, from, of } from 'rxjs';
import {
  catchError,
  filter,
  ignoreElements,
  mergeMap,
  map,
  withLatestFrom,
} from 'rxjs/operators';
import type { Epic } from 'redux-observable';
import { isActionOf } from 'typesafe-actions';
import type { RootAction, RootState } from '../../index.js';
import * as actions from './actions.js';
import * as accountsActions from '../accounts/actions.js';
import * as bootstrapActions from '../bootstrap/actions.js';
import * as sessionActions from '../session/actions.js';
import {
  clearScanFilterPreferences,
  getScanFilterPreferences,
  listFolders,
  onScanProgress,
  onScanSnapshotUpdated,
  saveScanFilterPreferences,
  scanCancel,
  scanStart,
} from '../../../ipc-client.js';
import { DEFAULT_SCAN_FILTERS } from './reducer.js';

export const fetchFoldersEpic: Epic<RootAction, RootAction, RootState> = (action$) =>
  action$.pipe(
    filter(isActionOf(actions.fetchFolders.request)),
    mergeMap(() =>
      from(listFolders()).pipe(
        map((folders) => actions.fetchFolders.success({ folders })),
        catchError((err: unknown) =>
          of(
            actions.fetchFolders.failure({
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
        ),
      ),
    ),
  );

export const startEpic: Epic<RootAction, RootAction, RootState> = (action$) =>
  action$.pipe(
    filter(isActionOf(actions.start.request)),
    mergeMap((action) =>
      from(scanStart(action.payload)).pipe(
        map((res) =>
          actions.start.success({
            runId: res.runId,
            contactsCount: res.contactsCount,
          }),
        ),
        catchError((err: unknown) =>
          of(
            actions.start.failure({
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
        ),
      ),
    ),
  );

export const cancelEpic: Epic<RootAction, RootAction, RootState> = (action$, state$) =>
  action$.pipe(
    filter(isActionOf(actions.cancel)),
    withLatestFrom(state$),
    mergeMap(([, state]) => {
      const runId = state.scan.runId;
      if (!runId) return of(actions.cancelDone());
      return from(scanCancel(runId)).pipe(
        map(() => actions.cancelDone()),
        catchError(() => of(actions.cancelDone())),
      );
    }),
  );

// Long-lived progress subscription. Wires window.api.scan.onProgress
// (a push channel from main) into the action stream.
export const progressEpic: Epic<RootAction, RootAction, RootState> = () =>
  new Observable<RootAction>((subscriber) => {
    const unsub = onScanProgress((payload) => {
      subscriber.next(actions.progress(payload));
    });
    return () => unsub();
  });

// Long-lived snapshot-delta subscription. Drives the live results table.
export const snapshotEpic: Epic<RootAction, RootAction, RootState> = () =>
  new Observable<RootAction>((subscriber) => {
    const unsub = onScanSnapshotUpdated((payload) => {
      subscriber.next(
        actions.snapshotAppended({
          runId: payload.runId,
          contacts: payload.contacts,
        }),
      );
    });
    return () => unsub();
  });

function isBootstrapConnected(
  action: ReturnType<typeof bootstrapActions.done>,
): action is ReturnType<typeof bootstrapActions.done> & {
  payload: { kind: 'connected' };
} {
  return action.payload.kind === 'connected';
}

export const loadFilterPreferencesEpic: Epic<RootAction, RootAction, RootState> = (
  action$,
) =>
  action$.pipe(
    filter(
      isActionOf([
        sessionActions.setActive,
        accountsActions.useSaved.success,
        bootstrapActions.done,
      ]),
    ),
    filter((action) => {
      if (isActionOf(bootstrapActions.done, action)) {
        return isBootstrapConnected(action);
      }
      return true;
    }),
    mergeMap(() =>
      from(getScanFilterPreferences()).pipe(
        map((preferences) =>
          actions.hydrateFilters(preferences?.filters ?? DEFAULT_SCAN_FILTERS),
        ),
        catchError(() => of(actions.hydrateFilters(DEFAULT_SCAN_FILTERS))),
      ),
    ),
  );

export const saveFilterPreferencesEpic: Epic<RootAction, RootAction, RootState> = (
  action$,
  state$,
) =>
  action$.pipe(
    filter(
      isActionOf([
        actions.setIncludeDomains,
        actions.setExcludeDomains,
        actions.setAutomationLocalParts,
        actions.setIncludeWordsInbound,
        actions.setExcludeWordsInbound,
        actions.setIncludeWordsOutbound,
        actions.setExcludeWordsOutbound,
        actions.setDirectionMode,
        actions.setMinMessages,
        actions.setParseBodies,
      ]),
    ),
    withLatestFrom(state$),
    mergeMap(([, state]) => {
      const {
        includeDomains,
        excludeDomains,
        automationLocalParts,
        includeWordsInbound,
        excludeWordsInbound,
        includeWordsOutbound,
        excludeWordsOutbound,
        directionMode,
        minMessages,
        parseBodies,
      } = state.scan;
      return from(
        saveScanFilterPreferences({
          version: 1,
          filters: {
            includeDomains: [...includeDomains],
            excludeDomains: [...excludeDomains],
            automationLocalParts: [...automationLocalParts],
            includeWordsInbound: [...includeWordsInbound],
            excludeWordsInbound: [...excludeWordsInbound],
            includeWordsOutbound: [...includeWordsOutbound],
            excludeWordsOutbound: [...excludeWordsOutbound],
            directionMode,
            minMessages,
            parseBodies,
          },
        }),
      ).pipe(ignoreElements(), catchError(() => EMPTY));
    }),
  );

export const clearFilterPreferencesEpic: Epic<RootAction, RootAction, RootState> = (
  action$,
) =>
  action$.pipe(
    filter(isActionOf(actions.resetFilters)),
    mergeMap(() => from(clearScanFilterPreferences()).pipe(ignoreElements(), catchError(() => EMPTY))),
  );
