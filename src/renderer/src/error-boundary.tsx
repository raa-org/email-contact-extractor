/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly hasError: boolean;
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Renderer-side: log to console for now; main has electron-log.
    console.error('Renderer ErrorBoundary caught:', error, info);
  }

  private retry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Box sx={{ p: 4, maxWidth: 720, mx: 'auto' }}>
          <Stack spacing={2}>
            <Typography variant="h5">Something went wrong.</Typography>
            <Typography variant="body2" color="text.secondary">
              {this.state.error?.message ?? 'Unknown error'}
            </Typography>
            <Box>
              <Button variant="contained" onClick={this.retry}>
                Retry
              </Button>
            </Box>
          </Stack>
        </Box>
      );
    }
    return this.props.children;
  }
}
