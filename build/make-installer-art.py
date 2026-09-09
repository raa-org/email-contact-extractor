#!/usr/bin/env python3
# Copyright (c) 2026 Right&Above, LLC
# https://rightandabove.com
# SPDX-License-Identifier: MIT

"""Generate the NSIS wizard bitmaps from build/icon.png.

NSIS wants plain 24-bit BMPs at fixed sizes, which no design tool in this
repo emits directly, so we compose them here:

  installerSidebar.bmp / uninstallerSidebar.bmp  164×314  welcome + finish pages
  installerHeader.bmp                            150×57   inner page header

Run after changing build/icon.png:

    python3 build/make-installer-art.py
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw

BUILD = pathlib.Path(__file__).resolve().parent
TOP = (233, 240, 255)
BOTTOM = (191, 212, 255)


def gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    w, h = size
    img = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(h - 1, 1)
        draw.line([(0, y), (w, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return img


def main() -> None:
    icon = Image.open(BUILD / "icon.png").convert("RGBA")

    def paste(bg: Image.Image, size: int, pos: tuple[int, int]) -> None:
        scaled = icon.resize((size, size), Image.LANCZOS)
        bg.paste(scaled, pos, scaled)

    sidebar = gradient((164, 314), TOP, BOTTOM)
    paste(sidebar, 104, (30, 74))
    sidebar.save(BUILD / "installerSidebar.bmp", format="BMP")
    sidebar.save(BUILD / "uninstallerSidebar.bmp", format="BMP")

    header = Image.new("RGB", (150, 57), (255, 255, 255))
    paste(header, 44, (99, 6))
    header.save(BUILD / "installerHeader.bmp", format="BMP")

    print("wrote installerSidebar.bmp, uninstallerSidebar.bmp, installerHeader.bmp")


if __name__ == "__main__":
    main()
