/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { createTheme, type Theme } from '@mui/material/styles';

const baseTheme = {
  typography: {
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  shape: { borderRadius: 8 },
};

export const lightTheme: Theme = createTheme({ ...baseTheme, palette: { mode: 'light' } });
export const darkTheme: Theme = createTheme({ ...baseTheme, palette: { mode: 'dark' } });

export function pickTheme(prefersDark: boolean): Theme {
  return prefersDark ? darkTheme : lightTheme;
}
