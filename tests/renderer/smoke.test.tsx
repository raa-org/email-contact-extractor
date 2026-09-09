/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('renderer smoke', () => {
  it('renders into jsdom', () => {
    render(<h1>hello</h1>);
    expect(screen.getByRole('heading', { name: 'hello' })).toBeInTheDocument();
  });
});
