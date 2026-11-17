// The Windows installer served at GET /v1/setup/windows.ps1. Like the Mac's (mac-script.ts) it
// holds no secret: the setup token comes in as its argument, through the one line shown in Michael
// (windowsInstallCommand), and the device key it is swapped for is written to
// %USERPROFILE%\.michael\michael.env, never to a URL.
//
// What it does, without admin rights where Windows allows:
// 1. ActivityWatch (open source, it records which app is in front): uses it if it already runs,
//    starts it if installed, else installs it with winget (ActivityWatch.ActivityWatch), else from
//    the official GitHub release, checked against the SHA-256 GitHub publishes for the file.
// 2. Uses this PC's Node.js if it is 22.13 or newer, else downloads the official Node 22 zip into
//    %USERPROFILE%\.michael\node and checks it against nodejs.org's SHA-256 list. No MSI, no admin.
// 3. Downloads apps/collector and packages/shared from the public GitHub repository into
//    %USERPROFILE%\.michael\app and installs the two packages they need (tsx, zod).
// 4. Swaps the setup token for an ingest only device key.
// 5. Writes Michael.ps1 (the launcher) and starts it at sign in: a Scheduled Task for this user, or
//    a line in the Startup folder when Task Scheduler says no. Then starts it, hidden.
//
// Untested on a real Windows machine so far: CI checks the text it serves (windows-script.test.ts,
// and parses it with PowerShell's own parser when pwsh is installed).
//
// PowerShell notes for anyone editing: this is String.raw, so backslashes stay as written; never
// use a backtick or a dollar sign followed by a brace in the script. It must never call `exit`: it
// runs inside the person's own PowerShell window, which `exit` would close.

const SAFE_URL = /^https?:\/\/[A-Za-z0-9.:_-]+$/;
const SAFE_PART = /^[A-Za-z0-9._/-]+$/;

export function windowsInstallScript(opts: { apiBase: string; repo: string; ref: string }): string {
  if (!SAFE_URL.test(opts.apiBase)) throw new Error(`Unsafe API base for the installer: ${opts.apiBase}`);
  if (!SAFE_PART.test(opts.repo) || !SAFE_PART.test(opts.ref))
    throw new Error(`Unsafe repository for the installer: ${opts.repo}@${opts.ref}`);
  return SCRIPT.replaceAll("__API__", opts.apiBase)
    .replaceAll("__REPO__", opts.repo)
    .replaceAll("__REF__", opts.ref);
}

/**
 * The one line shown with a Copy button, for PowerShell. A script block made from the download
 * takes the token as its argument, and runs whatever the execution policy (it is not a file).
 */
export const windowsInstallCommand = (apiBase: string, token: string) =>
  `[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; & ([scriptblock]::Create((irm ${apiBase}/v1/setup/windows.ps1))) ${token}`;

const SCRIPT = String.raw`# Michael for Windows. Installs and starts the collector, which reads which app is in front from
# ActivityWatch and sends it to Michael only. App names, never window titles. It never changes your
# files. No admin rights needed, except where Windows itself asks to install ActivityWatch.
# Source: https://github.com/__REPO__/tree/__REF__/apps/collector
param([string]$Token = "")

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Api = "__API__"
$Repo = "__REPO__"
$Ref = "__REF__"
$Dir = Join-Path $env:USERPROFILE ".michael"
$App = Join-Path $Dir "app"
$Config = Join-Path $Dir "michael.env"
$Launcher = Join-Path $Dir "Michael.ps1"
$TaskName = "Michael collector"
$AwInfo = "http://localhost:5600/api/0/info"

function Say([string]$Text) {
  Write-Host ""
  Write-Host $Text -ForegroundColor White
}

function Fail([string]$Text) {
  throw $Text
}

function Test-ActivityWatch {
  try {
    $null = Invoke-RestMethod -Uri $AwInfo -UseBasicParsing -TimeoutSec 3
    return $true
  } catch {
    return $false
  }
}

function Find-ActivityWatch {
  $places = @(
    (Join-Path $env:LOCALAPPDATA "Programs\ActivityWatch\aw-qt.exe"),
    (Join-Path $env:ProgramFiles "ActivityWatch\aw-qt.exe")
  )
  $x86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  if ($x86) { $places += (Join-Path $x86 "ActivityWatch\aw-qt.exe") }
  foreach ($p in $places) {
    if (Test-Path -LiteralPath $p) { return $p }
  }
  return $null
}

function Install-ActivityWatch {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Say "Installing ActivityWatch with winget"
    & winget install --id ActivityWatch.ActivityWatch --exact --silent --scope user --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Host
    if (-not (Find-ActivityWatch)) {
      & winget install --id ActivityWatch.ActivityWatch --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Host
    }
    if (Find-ActivityWatch) { return }
  }
  Say "Getting ActivityWatch from its official release"
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/ActivityWatch/activitywatch/releases/latest" -UseBasicParsing -Headers @{ "User-Agent" = "michael-setup" }
  $asset = $release.assets | Where-Object { $_.name -match '^activitywatch-v[0-9.]+-windows-x86_64-setup\.exe$' } | Select-Object -First 1
  if (-not $asset) { Fail "I could not find the ActivityWatch installer. Install it from activitywatch.net, then paste the line again." }
  $file = Join-Path $env:TEMP $asset.name
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $file -UseBasicParsing
  if ($asset.digest -and ([string]$asset.digest).StartsWith("sha256:")) {
    $want = ([string]$asset.digest).Substring(7)
    $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash
    if ($got -ne $want) {
      Remove-Item -LiteralPath $file -Force
      Fail "The ActivityWatch download did not match its checksum. Nothing was installed."
    }
  } else {
    Write-Host "GitHub lists no checksum for this file. It comes straight from the ActivityWatch release."
  }
  Start-Process -FilePath $file -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CURRENTUSER" -Wait
  Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
}

function Test-Node([string]$Exe) {
  try {
    $answer = & $Exe -e "const [a,b]=process.versions.node.split('.').map(Number);console.log(a>22||(a===22&&b>=13)?'ok':'old')"
    return ($answer -eq "ok")
  } catch {
    return $false
  }
}

function New-TempDir {
  $path = Join-Path $env:TEMP ("michael-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $path | Out-Null
  return $path
}

# Removes an old copy of the app. The link to packages\shared goes first, on its own, so its
# target is never emptied through it.
function Remove-App([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $link = Join-Path $Path "node_modules\@michael\shared"
  if (Test-Path -LiteralPath $link) {
    try { [System.IO.Directory]::Delete($link) } catch { }
  }
  Remove-Item -LiteralPath $Path -Recurse -Force
}

function Install-Michael {
  if ([Environment]::OSVersion.Platform -ne "Win32NT") { Fail "This installer is for Windows." }
  if ($Token -and ($Token -notmatch '^ms_[A-Za-z0-9_-]{20,}$')) {
    Fail "That does not look like a Michael setup line. Make a new one in Michael, You, Windows PC."
  }
  New-Item -ItemType Directory -Path $Dir -Force | Out-Null

  # A copy that is already running holds its files: stop it first.
  Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Stop-ScheduledTask -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains(".michael\app\apps\collector") } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  # 1. ActivityWatch, which records the app in front.
  Say "Checking ActivityWatch"
  if (-not (Test-ActivityWatch)) {
    $aw = Find-ActivityWatch
    if (-not $aw) {
      Install-ActivityWatch
      $aw = Find-ActivityWatch
    }
    if (-not $aw) { Fail "I could not find ActivityWatch after installing it. Install it from activitywatch.net, then paste the line again." }
    Start-Process -FilePath $aw
    for ($i = 0; $i -lt 60; $i++) {
      if (Test-ActivityWatch) { break }
      Start-Sleep -Seconds 1
    }
    if (-not (Test-ActivityWatch)) { Fail "ActivityWatch did not start. Open it from the Start menu, then paste the line again." }
  }
  Write-Host "ActivityWatch is running."

  # 2. Node.js 22.13 or newer.
  $node = $null
  $system = Get-Command node.exe -ErrorAction SilentlyContinue
  $private = Join-Path $Dir "node\node.exe"
  if ($system -and (Test-Node $system.Source) -and (Test-Path -LiteralPath (Join-Path (Split-Path $system.Source) "npm.cmd"))) {
    $node = $system.Source
  } elseif ((Test-Path -LiteralPath $private) -and (Test-Node $private)) {
    $node = $private
  } else {
    Say "Getting Node.js (a private copy in your .michael folder)"
    $arch = "x64"
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { $arch = "arm64" }
    $base = "https://nodejs.org/dist/latest-v22.x"
    $sums = [string](Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -UseBasicParsing).Content
    $line = $sums -split "\r?\n" | Where-Object { $_ -match "node-v[0-9.]+-win-$arch\.zip$" } | Select-Object -First 1
    if (-not $line) { Fail "I could not find Node.js for this PC." }
    $parts = $line -split "\s+"
    $sum = $parts[0]
    $file = $parts[1]
    $tmp = New-TempDir
    $zip = Join-Path $tmp "node.zip"
    Invoke-WebRequest -Uri "$base/$file" -OutFile $zip -UseBasicParsing
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash -ne $sum) { Fail "The Node.js download did not match its checksum. Nothing was installed." }
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    $target = Join-Path $Dir "node"
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    Move-Item -LiteralPath (Join-Path $tmp ($file -replace '\.zip$', '')) -Destination $target
    Remove-Item -LiteralPath $tmp -Recurse -Force
    $node = $private
  }
  $nodeDir = Split-Path $node
  $npm = Join-Path $nodeDir "npm.cmd"
  $env:Path = "$nodeDir;$env:Path"

  # 3. The collector, from the public repository.
  Say "Getting the Michael collector"
  $tmp = New-TempDir
  $tarball = Join-Path $tmp "src.tar.gz"
  Invoke-WebRequest -Uri "https://codeload.github.com/$Repo/tar.gz/$Ref" -OutFile $tarball -UseBasicParsing
  $next = "$App.new"
  Remove-App $next
  New-Item -ItemType Directory -Path $next | Out-Null
  $tar = Join-Path $env:SystemRoot "System32\tar.exe"
  & $tar -xzf $tarball -C $next --strip-components=1 "*/apps/collector" "*/packages/shared"
  if ($LASTEXITCODE -ne 0) { Fail "I could not unpack the collector. Paste the line again." }
  Remove-Item -LiteralPath $tmp -Recurse -Force
  [System.IO.File]::WriteAllText((Join-Path $next "package.json"), '{ "private": true, "type": "module" }')
  Push-Location -LiteralPath $next
  try {
    & $npm install --no-audit --no-fund --no-package-lock --loglevel=error tsx@4 zod@4 | Out-Null
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($code -ne 0) { Fail "npm could not install the collector's two packages. Check the connection and paste the line again." }
  Remove-App $App
  Move-Item -LiteralPath $next -Destination $App
  # The shared package, linked after the move (a junction keeps its full path). A copy if not allowed.
  $scope = Join-Path $App "node_modules\@michael"
  New-Item -ItemType Directory -Path $scope -Force | Out-Null
  $shared = Join-Path $App "packages\shared"
  try {
    New-Item -ItemType Junction -Path (Join-Path $scope "shared") -Target $shared | Out-Null
  } catch {
    Copy-Item -LiteralPath $shared -Destination (Join-Path $scope "shared") -Recurse
  }

  # 4. Your device key. The setup token works once; the key it becomes can only send data.
  if ($Token) {
    Say "Connecting this PC to your account"
    $answer = $null
    try {
      $body = @{ token = $Token } | ConvertTo-Json -Compress
      $answer = Invoke-RestMethod -Method Post -Uri "$Api/v1/setup-tokens/exchange" -ContentType "application/json" -Body $body -UseBasicParsing
    } catch {
      $answer = $null
    }
    if ($answer -and $answer.secret) {
      [System.IO.File]::WriteAllLines($Config, [string[]]@("MICHAEL_API_URL=$($answer.api_url)", "MICHAEL_API_KEY=$($answer.secret)"))
      # Current user only. Best effort: the folder is already private to this user by default.
      try { & icacls.exe $Config /inheritance:r /grant:r "$($env:USERNAME):F" 2>&1 | Out-Null } catch { }
    } elseif (Test-Path -LiteralPath $Config) {
      Write-Host "That setup line was used already. Keeping the key this PC has."
    } else {
      Fail "That setup line expired or was used. Make a new one in Michael, You, Windows PC."
    }
  }
  if (-not (Test-Path -LiteralPath $Config)) { Fail "No key yet. Make a setup line in Michael, You, Windows PC." }

  # 5. The launcher, started at sign in and now. Hidden: the log is collector.log in .michael.
  $launch = @'
# Starts Michael's collector, hidden. Started at sign in by the task "Michael collector".
# What it did last is in collector.log next to this file.
$Dir = Join-Path $env:USERPROFILE ".michael"
$Node = "__NODE__"
# ActivityWatch first: it is what the collector reads.
try {
  $null = Invoke-RestMethod -Uri "http://localhost:5600/api/0/info" -UseBasicParsing -TimeoutSec 3
} catch {
  foreach ($aw in @((Join-Path $env:LOCALAPPDATA "Programs\ActivityWatch\aw-qt.exe"), (Join-Path $env:ProgramFiles "ActivityWatch\aw-qt.exe"))) {
    if (Test-Path -LiteralPath $aw) {
      Start-Process -FilePath $aw
      Start-Sleep -Seconds 20
      break
    }
  }
}
# Where to send and the device key, for the collector (and nothing else) to read.
foreach ($line in Get-Content -LiteralPath (Join-Path $Dir "michael.env")) {
  if ($line -match '^(MICHAEL_[A-Z_]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), "Process")
  }
}
$Collector = Join-Path $Dir "app\apps\collector"
# The full path in quotes: a user name may have a space, and the installer finds a running copy by it.
$Entry = '"' + (Join-Path $Collector "src\index.ts") + '"'
Start-Process -FilePath $Node -ArgumentList "--import", "tsx", $Entry -WorkingDirectory $Collector -RedirectStandardOutput (Join-Path $Dir "collector.log") -RedirectStandardError (Join-Path $Dir "collector-errors.log") -WindowStyle Hidden -Wait
'@
  $launch = $launch.Replace("__NODE__", $node)
  [System.IO.File]::WriteAllText($Launcher, $launch, (New-Object System.Text.UTF8Encoding $true))

  $argLine = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $Launcher + '"'
  $how = "task"
  try {
    $me = "$env:USERDOMAIN\$env:USERNAME"
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argLine -WorkingDirectory $Dir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $me
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  } catch {
    $how = "startup"
    $startup = [Environment]::GetFolderPath("Startup")
    $cmd = '@echo off' + [Environment]::NewLine + 'start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%USERPROFILE%\.michael\Michael.ps1"'
    [System.IO.File]::WriteAllText((Join-Path $startup "Michael.cmd"), $cmd)
  }

  Say "Starting Michael"
  if ($how -eq "task") {
    Start-ScheduledTask -TaskName $TaskName
  } else {
    Start-Process -FilePath "powershell.exe" -ArgumentList $argLine -WindowStyle Hidden
  }

  Say "Michael is running in the background. You can close this window."
  Write-Host "It starts again when you sign in. It sends app names and times, never window titles."
  Write-Host "Back in Michael, your first data shows within two minutes."
}

try {
  Install-Michael
} catch {
  Write-Host ""
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host "I stopped there. Paste the line again when you are ready."
}
`;
