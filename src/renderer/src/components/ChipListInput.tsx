/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';
import { Box, Button, Chip, Stack, TextField, Typography } from '@mui/material';

interface Props {
  readonly label: string;
  readonly placeholder?: string;
  readonly values: readonly string[];
  readonly onAdd: (value: string) => void;
  readonly onRemove: (value: string) => void;
  readonly disabled?: boolean;
}

// Reusable "label + chip stack + text input + Add button" trio for the
// Filters block on ScanScreen. Trimming, dedup, empty-string rejection
// happen here so the parent only sees clean values. Enter inside the
// input triggers Add.
export function ChipListInput({
  label,
  placeholder,
  values,
  onAdd,
  onRemove,
  disabled,
}: Props) {
  const [input, setInput] = useState('');

  const tryAdd = (): void => {
    const trimmed = input.trim();
    if (trimmed.length === 0) return;
    if (values.includes(trimmed)) {
      setInput('');
      return;
    }
    onAdd(trimmed);
    setInput('');
  };

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {label}
      </Typography>
      {values.length > 0 && (
        <Stack
          direction="row"
          spacing={1}
          sx={{ flexWrap: 'wrap', gap: 0.75, mb: 1 }}
        >
          {values.map((v) => (
            <Chip
              key={v}
              label={v}
              size="small"
              onDelete={disabled ? undefined : () => onRemove(v)}
              // Cap width so a pathologically long token (e.g., an
              // accidentally pasted paragraph) can't blow out the row;
              // ellipsis keeps the chip readable inside the cap.
              sx={{ maxWidth: 280 }}
            />
          ))}
        </Stack>
      )}
      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          placeholder={placeholder ?? ''}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              tryAdd();
            }
          }}
          sx={{ flex: 1 }}
          disabled={disabled === true}
          // aria-label needs to land on the actual <input>, not the
          // wrapper div, otherwise getByLabelText resolves to a non-
          // input element and value-setter helpers blow up.
          slotProps={{ htmlInput: { 'aria-label': label } }}
        />
        <Button
          size="small"
          variant="outlined"
          onClick={tryAdd}
          disabled={disabled === true || input.trim().length === 0}
        >
          Add
        </Button>
      </Stack>
    </Box>
  );
}
