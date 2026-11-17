import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { windowsInstallCommand, windowsInstallScript } from "./windows-script";

// The Windows installer cannot run here. These checks guard the text it serves; when PowerShell
// (pwsh) is installed, its own parser reads the script too. Nobody has run it on a real Windows PC
// yet (see apps/collector/README.md, Windows).

const script = windowsInstallScript({
  apiBase: "https://api.example.com",
  repo: "loukas-hackathon/michael-hachathon",
  ref: "main",
});

test("the Windows installer is filled in, plain ASCII and holds no secret", () => {
  assert.doesNotMatch(script, /__API__|__REPO__|__REF__/, "every placeholder is filled");
  assert.match(script, /\$Api = "https:\/\/api\.example\.com"/);
  assert.match(script, /codeload\.github\.com\/\$Repo\/tar\.gz\/\$Ref/);
  assert.match(script, /\/v1\/setup-tokens\/exchange/);
  assert.doesNotMatch(script, /mk_[A-Za-z0-9]/, "no device key in the script");
  // Windows PowerShell 5.1 reads a download as one string; non ASCII text could arrive garbled.
  assert.ok(
    [...script].every((ch) => ch === "\t" || ch === "\n" || ch === "\r" || (ch >= " " && ch <= "~")),
    "ASCII only",
  );
  // A backtick is PowerShell's escape; none was meant (the source is a String.raw template).
  assert.ok(!script.includes("`"), "no backticks");
});

test("the Windows installer takes the token first, never exits the window, and does each step", () => {
  // param() must be the first statement: only comments above it.
  const beforeParam = script.slice(0, script.indexOf("param("));
  assert.ok(
    beforeParam.split("\n").every((l) => l.trim() === "" || l.trim().startsWith("#")),
    "param() comes first",
  );
  // It runs inside the person's own PowerShell window: exit would close it.
  assert.doesNotMatch(script, /^\s*exit\b/im);
  for (const step of [
    "ActivityWatch.ActivityWatch", // winget
    "api.github.com/repos/ActivityWatch/activitywatch/releases/latest", // the fallback
    "Get-FileHash -Algorithm SHA256", // checksums
    "https://nodejs.org/dist/latest-v22.x", // private Node
    "Register-ScheduledTask", // at sign in
    'GetFolderPath("Startup")', // or the Startup folder
    "Start-ScheduledTask",
  ])
    assert.ok(script.includes(step), step);
  // Braces and parentheses pair up (outside the quoted strings that hold none).
  const count = (ch: string) => script.split(ch).length - 1;
  assert.equal(count("{"), count("}"));
  assert.equal(count("("), count(")"));
});

test("the Windows install line passes the token to the downloaded script", () => {
  assert.equal(
    windowsInstallCommand("https://api.example.com", "ms_abc"),
    "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; & ([scriptblock]::Create((irm https://api.example.com/v1/setup/windows.ps1))) ms_abc",
  );
  assert.throws(() => windowsInstallScript({ apiBase: "https://x.com; rm -rf ~", repo: "a/b", ref: "main" }));
  assert.throws(() => windowsInstallScript({ apiBase: "https://x.com", repo: "a/b$(x)", ref: "main" }));
});

test("PowerShell's own parser reads the installer without errors (when pwsh is installed)", (t) => {
  const found = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
    encoding: "utf8",
  });
  if (found.error) {
    // Not a skip of the checks above: this one needs PowerShell, which CI does not have.
    t.diagnostic("pwsh is not installed here; the parser check did not run");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "michael-ps-"));
  try {
    const file = join(dir, "windows.ps1");
    writeFileSync(file, script);
    const check = spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-Command",
        `$errors = $null; $tokens = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file}', [ref]$tokens, [ref]$errors); if ($errors.Count) { $errors | ForEach-Object { $_.Message }; exit 1 }`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(check.status, 0, check.stdout + check.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
