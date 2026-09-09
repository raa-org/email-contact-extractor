#!/usr/bin/env python3
"""Add MIT SPDX headers to sources (skip if already present).

Mirrors trusted-modules/scripts/add-copyright-headers.py so every public
Right&Above repository carries the same header. Run from the repo root:

    python3 build/add-copyright-headers.py
"""

from __future__ import annotations

import sys
from pathlib import Path

C_HEADER = """\
/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

"""

HASH_HEADER = """\
# Copyright (c) 2026 Right&Above, LLC
# https://rightandabove.com
# SPDX-License-Identifier: MIT

"""

C_EXTS = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".css"}
HASH_EXTS = {".py", ".sh"}
SKIP_DIRS = {"node_modules", "dist", "out", ".git", "coverage", "docs"}


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    added = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if SKIP_DIRS & set(path.parts):
            continue
        if path.suffix in C_EXTS:
            header = C_HEADER
        elif path.suffix in HASH_EXTS:
            header = HASH_HEADER
        else:
            continue

        text = path.read_text(encoding="utf-8")
        if "SPDX-License-Identifier" in text[:800]:
            continue
        # A shebang must stay on line 1, so the header goes after it.
        if text.startswith("#!"):
            nl = text.find("\n")
            text = text[: nl + 1] + header + text[nl + 1 :]
        else:
            text = header + text
        path.write_text(text, encoding="utf-8")
        added += 1

    print(f"headers added: {added}")


if __name__ == "__main__":
    main()
