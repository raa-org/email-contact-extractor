/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import type { Api } from '../../preload';

declare global {
  interface Window {
    api: Api;
  }
}

export {};
