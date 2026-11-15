#!/bin/bash
# Builds and signs the Michael shortcut on a Mac (#303). Needs macOS 12+ signed in to iCloud, online.
# Output: apps/web/public/Michael.shortcut, served at <web>/Michael.shortcut.
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/shortcut/build.mjs --out scripts/shortcut/out/Michael.shortcut "$@"
shortcuts sign --mode anyone --input scripts/shortcut/out/Michael.shortcut --output apps/web/public/Michael.shortcut
echo "Signed: apps/web/public/Michael.shortcut. Open it on this Mac first to check it imports."
