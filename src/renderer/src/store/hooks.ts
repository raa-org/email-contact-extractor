/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import type { Dispatch } from 'redux';
import type { RootAction, RootState } from './index.js';

export const useAppDispatch = (): Dispatch<RootAction> => useDispatch<Dispatch<RootAction>>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
