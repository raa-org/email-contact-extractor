/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { createAction } from 'typesafe-actions';

export interface ActiveAccount {
  readonly username: string;
  readonly host: string;
}

export const setActive = createAction('session/setActive')<ActiveAccount>();
export const clear = createAction('session/clear')();
