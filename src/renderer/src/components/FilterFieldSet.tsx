/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';

interface Props {
  readonly title: string;
  readonly helperText?: string;
  readonly children: ReactNode;
}

// Shared fieldset wrapper for scan filter groups so related controls are
// visually grouped with consistent border, spacing, and legend labeling.
export function FilterFieldSet({ title, helperText, children }: Props) {
  return (
    <Box
      component="fieldset"
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        px: 2,
        pt: 0.5,
        pb: 2,
        m: 0,
        minWidth: 0,
      }}
    >
      <Box
        component="legend"
        sx={{ px: 0.75, color: 'text.secondary', fontSize: 13 }}
      >
        {title}
        {helperText !== undefined && (
          <Typography
            component="span"
            variant="caption"
            color="text.secondary"
            sx={{ ml: 1 }}
          >
            {helperText}
          </Typography>
        )}
      </Box>
      <Box sx={{ mt: 1 }}>{children}</Box>
    </Box>
  );
}
