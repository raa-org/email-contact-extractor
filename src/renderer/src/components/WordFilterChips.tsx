/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';
import {
  Box,
  FormLabel,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { ChipListInput } from './ChipListInput.js';
import { formatCount } from '../../../shared/format-count.js';

interface Props {
  readonly parseBodies: boolean;
  readonly inboundInclude: readonly string[];
  readonly inboundExclude: readonly string[];
  readonly outboundInclude: readonly string[];
  readonly outboundExclude: readonly string[];
  readonly onInboundIncludeChange: (v: readonly string[]) => void;
  readonly onInboundExcludeChange: (v: readonly string[]) => void;
  readonly onOutboundIncludeChange: (v: readonly string[]) => void;
  readonly onOutboundExcludeChange: (v: readonly string[]) => void;
}

// Words / tags filter section for the Scan screen. Owns its own
// inbound/outbound tab state (UI-only — the four chip arrays themselves
// live in the scan slice). Renders the active direction's two chip
// inputs full-width so an asymmetric chip count never makes the box
// look lopsided. Subject-only matching is the default; with parseBodies
// the body is added to the haystack with quoted-reply text stripped.
export function WordFilterChips({
  parseBodies,
  inboundInclude,
  inboundExclude,
  outboundInclude,
  outboundExclude,
  onInboundIncludeChange,
  onInboundExcludeChange,
  onOutboundIncludeChange,
  onOutboundExcludeChange,
}: Props) {
  const [tab, setTab] = useState<'in' | 'out'>('in');
  const inboundCount = inboundInclude.length + inboundExclude.length;
  const outboundCount = outboundInclude.length + outboundExclude.length;

  // Add/remove helpers per (direction × include/exclude). Always emits
  // a brand-new array so the parent reducer can shallow-compare and the
  // chip list re-renders.
  const add =
    (current: readonly string[], change: (next: readonly string[]) => void) =>
    (v: string): void => {
      change([...current, v]);
    };
  const remove =
    (current: readonly string[], change: (next: readonly string[]) => void) =>
    (v: string): void => {
      change(current.filter((x) => x !== v));
    };

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
        Words / tags
        <Typography
          component="span"
          variant="caption"
          color="text.secondary"
          sx={{ ml: 1 }}
        >
          ({parseBodies
            ? 'Subject + body, quoted-reply text stripped'
            : 'Subject only, enable "Parse bodies" to match body'})
        </Typography>
      </Box>
      <ToggleButtonGroup
        size="small"
        exclusive
        fullWidth
        value={tab}
        onChange={(_, v: 'in' | 'out' | null) => {
          if (v !== null) setTab(v);
        }}
        aria-label="words direction"
        sx={{ mt: 1, mb: 2 }}
      >
        <ToggleButton value="in" sx={{ textTransform: 'none', py: 1 }}>
          Inbound (from contact)
          {inboundCount > 0 ? ` · ${formatCount(inboundCount)}` : ''}
        </ToggleButton>
        <ToggleButton value="out" sx={{ textTransform: 'none', py: 1 }}>
          Outbound (to contact)
          {outboundCount > 0 ? ` · ${formatCount(outboundCount)}` : ''}
        </ToggleButton>
      </ToggleButtonGroup>
      <FormLabel sx={{ display: 'none' }}>placeholder</FormLabel>
      <Stack spacing={1.5}>
        {tab === 'in' ? (
          <>
            <ChipListInput
              label="Include (empty = all)"
              values={inboundInclude}
              onAdd={add(inboundInclude, onInboundIncludeChange)}
              onRemove={remove(inboundInclude, onInboundIncludeChange)}
            />
            <ChipListInput
              label="Exclude"
              values={inboundExclude}
              onAdd={add(inboundExclude, onInboundExcludeChange)}
              onRemove={remove(inboundExclude, onInboundExcludeChange)}
            />
          </>
        ) : (
          <>
            <ChipListInput
              label="Include (empty = all)"
              values={outboundInclude}
              onAdd={add(outboundInclude, onOutboundIncludeChange)}
              onRemove={remove(outboundInclude, onOutboundIncludeChange)}
            />
            <ChipListInput
              label="Exclude"
              values={outboundExclude}
              onAdd={add(outboundExclude, onOutboundExcludeChange)}
              onRemove={remove(outboundExclude, onOutboundExcludeChange)}
            />
          </>
        )}
      </Stack>
    </Box>
  );
}
