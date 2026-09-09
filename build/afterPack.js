/*
 * Copyright (c) 2026 Right&Above, LLC
 * https://rightandabove.com
 * SPDX-License-Identifier: MIT
 */

// Ad-hoc signs the macOS .app bundle so it is launchable on Apple Silicon
// even without a Developer ID certificate. Without ANY signature the kernel
// kills the process on launch ("can't be opened" with no further detail).
// Runs only for darwin builds; a no-op on win/linux.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  execFileSync('codesign', ['--sign', '-', '--force', '--deep', appPath], {
    stdio: 'inherit',
  });
};
