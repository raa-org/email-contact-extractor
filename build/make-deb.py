#!/usr/bin/env python3
# Copyright (c) 2026 Right&Above, LLC
# https://rightandabove.com
# SPDX-License-Identifier: MIT

"""Build a Debian package from dist/linux-unpacked.

electron-builder's bundled fpm (1.9.3) produces a corrupt 96-byte archive when
run on recent macOS — it shells out to BSD `ar`, which writes a Mach-O symbol
table instead of a plain member list. A .deb is just an `ar` archive of three
members, so we emit it directly and skip fpm entirely. Output is byte-for-byte
equivalent to what fpm would have produced on Linux.
"""

from __future__ import annotations

import gzip
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UNPACKED = ROOT / "dist" / "linux-unpacked"
OUT_DIR = ROOT / "dist"

PKG = "contact-extractor"
ARCH = "amd64"
INSTALL_DIR = "opt/Contact Extractor"
EXECUTABLE = "contact-extractor"

# hicolor sizes shipped so the launcher, dock and window manager all find an
# icon; the source is the same build/icon.png electron-builder uses.
ICON_SIZES = (16, 24, 32, 48, 64, 128, 256, 512, 1024)

DESKTOP = """[Desktop Entry]
Name=Contact Extractor
Comment=Extract business contacts from an IMAP mailbox
Exec="/opt/Contact Extractor/{exe}" %U
Terminal=false
Type=Application
Icon={pkg}
StartupWMClass=Contact Extractor
Categories=Office;
"""

# chrome-sandbox must be setuid root or Electron refuses to start on distros
# with unprivileged user namespaces disabled.
POSTINST = """#!/bin/bash
set -e
chmod 4755 '/opt/Contact Extractor/chrome-sandbox' || true
update-desktop-database /usr/share/applications || true
"""

PRERM = """#!/bin/bash
set -e
"""


def tar_add_bytes(tar: tarfile.TarFile, name: str, data: bytes, mode: int, mtime: int) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mode = mode
    info.mtime = mtime
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    tar.addfile(info, io.BytesIO(data))


def tar_add_dir(tar: tarfile.TarFile, name: str, mtime: int) -> None:
    info = tarfile.TarInfo(name)
    info.type = tarfile.DIRTYPE
    info.mode = 0o755
    info.mtime = mtime
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    tar.addfile(info)


def normalize(info: tarfile.TarInfo) -> tarfile.TarInfo:
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    return info


def ar_member(name: str, data: bytes, mtime: int) -> bytes:
    header = (
        f"{name:<16}{mtime:<12}{0:<6}{0:<6}{100644:<8}{len(data):<10}`\n"
    ).encode()
    padding = b"\n" if len(data) % 2 else b""
    return header + data + padding


def icon_pngs() -> dict[int, bytes]:
    """Resize build/icon.png into the hicolor sizes, keyed by pixel size."""
    from PIL import Image

    src_path = ROOT / "build" / "icon.png"
    src = Image.open(src_path).convert("RGBA")
    out: dict[int, bytes] = {}
    for size in ICON_SIZES:
        buf = io.BytesIO()
        img = src if src.size == (size, size) else src.resize((size, size), Image.LANCZOS)
        img.save(buf, format="PNG", optimize=True)
        out[size] = buf.getvalue()
    return out


def main() -> int:
    if not UNPACKED.is_dir():
        print(f"missing {UNPACKED}; run electron-builder --linux first", file=sys.stderr)
        return 1

    meta = json.loads((ROOT / "package.json").read_text())
    version = meta["version"]
    mtime = int(time.time())

    installed_size = sum(
        p.stat().st_size for p in UNPACKED.rglob("*") if p.is_file()
    ) // 1024

    control = (
        f"Package: {PKG}\n"
        f"Version: {version}\n"
        f"License: MIT\n"
        f"Vendor: {meta.get('author', 'Right&Above LLC')}\n"
        f"Architecture: {ARCH}\n"
        f"Maintainer: Right&Above, LLC <opensource@rightandabove.com>\n"
        f"Installed-Size: {installed_size}\n"
        # libasound2 is required by the bundled Electron (libasound.so.2 shows
        # up as "not found" in ldd without it) and is missing from
        # electron-builder's own default dependency list.
        "Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, "
        "libatspi2.0-0, libuuid1, libsecret-1-0, libasound2\n"
        "Section: office\n"
        "Priority: optional\n"
        f"Homepage: {meta.get('homepage', '')}\n"
        f"Description: {meta['description']}\n"
    )

    # --- data.tar.gz: the payload, laid out as it lands on the filesystem ---
    data_raw = io.BytesIO()
    with tarfile.open(fileobj=data_raw, mode="w", format=tarfile.GNU_FORMAT) as tar:
        for d in ("./opt", f"./{INSTALL_DIR}", "./usr", "./usr/share",
                  "./usr/share/applications", "./usr/bin"):
            tar_add_dir(tar, d, mtime)
        for path in sorted(UNPACKED.rglob("*")):
            rel = path.relative_to(UNPACKED)
            tar.add(path, arcname=f"./{INSTALL_DIR}/{rel}", recursive=False,
                    filter=normalize)
        tar_add_bytes(
            tar, "./usr/share/applications/contact-extractor.desktop",
            DESKTOP.format(exe=EXECUTABLE, pkg=PKG).encode(), 0o644, mtime,
        )
        # dpkg does not create parent directories implicitly — every level
        # needs its own member or unpacking fails with "No such file or
        # directory" on the first icon.
        tar_add_dir(tar, "./usr/share/icons", mtime)
        tar_add_dir(tar, "./usr/share/icons/hicolor", mtime)
        for size, png in icon_pngs().items():
            base = f"./usr/share/icons/hicolor/{size}x{size}"
            tar_add_dir(tar, base, mtime)
            tar_add_dir(tar, f"{base}/apps", mtime)
            tar_add_bytes(tar, f"{base}/apps/{PKG}.png", png, 0o644, mtime)
        link = tarfile.TarInfo("./usr/bin/contact-extractor")
        link.type = tarfile.SYMTYPE
        link.linkname = f"/{INSTALL_DIR}/{EXECUTABLE}"
        link.mode = 0o755
        link.mtime = mtime
        link.uid = link.gid = 0
        link.uname = link.gname = "root"
        tar.addfile(link)
    data_gz = gzip.compress(data_raw.getvalue(), 9)

    # --- control.tar.gz: metadata + maintainer scripts ---
    control_raw = io.BytesIO()
    with tarfile.open(fileobj=control_raw, mode="w", format=tarfile.GNU_FORMAT) as tar:
        tar_add_dir(tar, "./", mtime)
        tar_add_bytes(tar, "./control", control.encode(), 0o644, mtime)
        tar_add_bytes(tar, "./postinst", POSTINST.encode(), 0o755, mtime)
        tar_add_bytes(tar, "./prerm", PRERM.encode(), 0o755, mtime)
    control_gz = gzip.compress(control_raw.getvalue(), 9)

    out = OUT_DIR / f"{PKG}-{version}-{ARCH}.deb"
    with out.open("wb") as fh:
        fh.write(b"!<arch>\n")
        fh.write(ar_member("debian-binary", b"2.0\n", mtime))
        fh.write(ar_member("control.tar.gz", control_gz, mtime))
        fh.write(ar_member("data.tar.gz", data_gz, mtime))

    print(f"{out}  {out.stat().st_size / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
