// The Mac installer served at GET /v1/setup/mac.sh (#120). It holds no secret: the setup token
// comes in as its first argument (`curl -fsSL <api>/v1/setup/mac.sh | bash -s -- ms_...`), and the
// device key it is swapped for is written to ~/.michael/michael.env (mode 600), never to a URL.
//
// What it does, without admin rights:
// 1. Uses the Mac's own Node.js if it is 22.13 or newer (node:sqlite), else downloads the official
//    Node 22 build into ~/.michael/node and checks its SHA-256 against nodejs.org's list.
// 2. Downloads apps/collector and packages/shared from the public GitHub repository into
//    ~/.michael/app and installs the two packages they need (tsx, zod).
// 3. Swaps the setup token for an ingest only device key.
// 4. Writes ~/.michael/Michael.command (double-click to start again) and a login item that opens it
//    in Terminal at login, so Full Disk Access granted to Terminal keeps applying.
// 5. Points to Full Disk Access if Terminal lacks it, then starts the collector in this window.

const SAFE_URL = /^https?:\/\/[A-Za-z0-9.:_-]+$/;

export function macInstallScript(opts: { apiBase: string; repo: string; ref: string }): string {
  if (!SAFE_URL.test(opts.apiBase)) throw new Error(`Unsafe API base for the installer: ${opts.apiBase}`);
  return SCRIPT.replaceAll("__API__", opts.apiBase)
    .replaceAll("__REPO__", opts.repo)
    .replaceAll("__REF__", opts.ref);
}

/** The one line shown with a Copy button, and the body of the downloadable .command file. */
export const macInstallCommand = (apiBase: string, token: string) =>
  `curl -fsSL ${apiBase}/v1/setup/mac.sh | bash -s -- ${token}`;

const SCRIPT = `#!/bin/bash
# Michael for Mac. Installs and starts the collector, which reads what this Mac already knows about
# your day and sends it to Michael only. It never changes your files. No admin rights needed.
# Source: https://github.com/__REPO__/tree/__REF__/apps/collector
set -euo pipefail

API="__API__"
REPO="__REPO__"
REF="__REF__"
TOKEN="\${1:-}"
DIR="$HOME/.michael"
APP="$DIR/app"
CONFIG="$DIR/michael.env"
LAUNCHER="$DIR/Michael.command"
AGENT="$HOME/Library/LaunchAgents/app.michael.collector.plist"

say() { printf '\\n\\033[1m%s\\033[0m\\n' "$1"; }
fail() { printf '\\n\\033[31m%s\\033[0m\\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "This installer is for macOS."
if [ -n "$TOKEN" ] && ! [[ "$TOKEN" =~ ^ms_[A-Za-z0-9_-]{20,}$ ]]; then
  fail "That does not look like a Michael setup link. Make a new one in Michael, You, Mac."
fi
mkdir -p "$DIR"
chmod 700 "$DIR"

# 1. Node.js 22.13 or newer.
node_ok() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; }
NODE=""
if command -v node >/dev/null 2>&1 && node_ok "$(command -v node)" && [ -x "$(dirname "$(command -v node)")/npm" ]; then
  NODE="$(command -v node)"
elif [ -x "$DIR/node/bin/node" ] && node_ok "$DIR/node/bin/node"; then
  NODE="$DIR/node/bin/node"
else
  say "Getting Node.js (a private copy in ~/.michael)"
  ARCH="$(uname -m)"
  [ "$ARCH" = "x86_64" ] && ARCH="x64"
  BASE="https://nodejs.org/dist/latest-v22.x"
  LINE="$(curl -fsSL "$BASE/SHASUMS256.txt" | grep "darwin-$ARCH.tar.gz$" | head -n 1)"
  [ -n "$LINE" ] || fail "Could not find Node.js for this Mac."
  SUM="\${LINE%% *}"
  FILE="\${LINE##* }"
  TMP="$(mktemp -d)"
  curl -fsSL "$BASE/$FILE" -o "$TMP/node.tar.gz"
  echo "$SUM  $TMP/node.tar.gz" | shasum -a 256 -c - >/dev/null || fail "Node.js download did not match its checksum."
  rm -rf "$DIR/node"
  mkdir -p "$DIR/node"
  tar -xzf "$TMP/node.tar.gz" -C "$DIR/node" --strip-components=1
  rm -rf "$TMP"
  NODE="$DIR/node/bin/node"
fi
NODE_DIR="$(dirname "$NODE")"
export PATH="$NODE_DIR:$PATH"

# 2. The collector, from the public repository.
say "Getting the Michael collector"
TMP="$(mktemp -d)"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" -o "$TMP/src.tar.gz"
rm -rf "$APP.new"
mkdir -p "$APP.new"
tar -xzf "$TMP/src.tar.gz" -C "$APP.new" --strip-components=1 "*/apps/collector" "*/packages/shared"
rm -rf "$TMP"
printf '{ "private": true, "type": "module" }\\n' > "$APP.new/package.json"
(cd "$APP.new" && npm install --no-audit --no-fund --no-package-lock --loglevel=error tsx@4 zod@4 >/dev/null)
# After npm, which would prune a link it did not make.
mkdir -p "$APP.new/node_modules/@michael"
ln -s ../../packages/shared "$APP.new/node_modules/@michael/shared"
rm -rf "$APP"
mv "$APP.new" "$APP"

# 3. Your device key. The setup token works once; the key it becomes can only send data.
if [ -n "$TOKEN" ]; then
  say "Connecting this Mac to your account"
  if RESP="$(curl -fsS -X POST "$API/v1/setup-tokens/exchange" -H 'content-type: application/json' --data "{\\"token\\":\\"$TOKEN\\"}")"; then
    KEY="$(printf '%s' "$RESP" | "$NODE" -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>process.stdout.write(JSON.parse(s).secret))')"
    URL="$(printf '%s' "$RESP" | "$NODE" -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>process.stdout.write(JSON.parse(s).api_url))')"
    (umask 077 && printf 'MICHAEL_API_URL=%s\\nMICHAEL_API_KEY=%s\\n' "$URL" "$KEY" > "$CONFIG")
  elif [ -f "$CONFIG" ]; then
    echo "That setup link was used already. Keeping the key this Mac has."
  else
    fail "That setup link expired or was used. Make a new one in Michael, You, Mac."
  fi
fi
[ -f "$CONFIG" ] || fail "No key yet. Make a setup link in Michael, You, Mac."

# 4. Start again later with a double-click, and at login.
cat > "$LAUNCHER" <<LAUNCH
#!/bin/bash
# Starts Michael's collector. Keep this window open; close it to stop.
set -a
. "$CONFIG"
set +a
export PATH="$NODE_DIR:\\$PATH"
cd "$APP/apps/collector"
exec "$APP/node_modules/.bin/tsx" src/index.ts "\\$@"
LAUNCH
chmod 755 "$LAUNCHER"
mkdir -p "$(dirname "$AGENT")"
cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>app.michael.collector</string>
  <key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-a</string><string>Terminal</string><string>$LAUNCHER</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLIST

# 5. App time needs Full Disk Access for Terminal. Chrome and Claude Code work without it.
if ! ls "$HOME/Library/Safari" >/dev/null 2>&1; then
  say "One more thing: Full Disk Access"
  echo "For app time, turn on Terminal in the list that opens now, then start Michael again."
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" || true
fi

say "Michael is running. Keep this window open."
echo "To start again later, double-click Michael.command in ~/.michael. It also starts at login."
exec "$LAUNCHER"
`;
