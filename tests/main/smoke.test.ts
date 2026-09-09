/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';

describe('main smoke', () => {
  it('vitest runs in node env', () => {
    expect(typeof process.versions.node).toBe('string');
  });
});
