// Pure helpers for one tap device setup (#120). No secrets are stored here: each function turns a
// key or a setup token the page just received into the link or file that hands it to the device.

/** App Store page of Health Auto Export (the bridge from Apple Health; automations need Premium). */
export const HEALTH_AUTO_EXPORT_APP_STORE = "https://apps.apple.com/app/id1115567069";

// Exactly as Health Auto Export names them. Everything else Apple Health holds stays on the phone.
const METRICS = [
  "Sleep Analysis",
  "Heart Rate",
  "Resting Heart Rate",
  "Heart Rate Variability",
  "Step Count",
  "Active Energy",
];

/**
 * Health Auto Export's deep link (com.HealthExport://automation, see
 * help.healthyapps.dev/en/health-auto-export/automations/deep-link) creates a REST API automation
 * with the URL, the Authorization header and every setting filled in. One automation carries one
 * data type, so there are two links: health metrics, then workouts. The order of the parameters
 * matters to the app (data type before its options, format before aggregation), so they are
 * written out by hand. The key goes in a header, never in the webhook URL, so it stays out of logs.
 */
export function healthAutoExportLinks(apiBase: string, key: string) {
  const url = encodeURIComponent(`${apiBase.replace(/\/$/, "")}/v1/webhooks/health-auto-export`);
  const headers = `Authorization,${encodeURIComponent(`Bearer ${key}`)}`;
  const enc = (s: string) => encodeURIComponent(s);
  const common = "&syncinterval=minutes&syncquantity=5&notifyonupdate=false&notifywhenrun=false";
  const metrics = [
    `url=${url}`,
    `name=${enc("Michael health")}`,
    "enabled=true",
    "datatype=healthMetrics",
    "format=json",
    "exportversion=v2",
    `headers=${headers}`,
    `metrics=${METRICS.map(enc).join(",")}`,
    "aggregatedata=true",
    "interval=hours",
    "aggregatesleep=true",
  ].join("&");
  const workouts = [
    `url=${url}`,
    `name=${enc("Michael workouts")}`,
    "enabled=true",
    "datatype=workouts",
    "format=json",
    "exportversion=v2",
    `headers=${headers}`,
    // Routes are never stored, so they are never sent.
    "includeroutes=false",
    "includeworkoutmetadata=true",
    "workoutsmetadatainterval=minutes",
  ].join("&");
  return {
    metrics: `com.HealthExport://automation?${metrics}${common}`,
    workouts: `com.HealthExport://automation?${workouts}${common}`,
  };
}

/** The name of the Michael shortcut (docs/sources/ios-shortcuts.md, "One tap set up"). */
export const SHORTCUT_NAME = "Michael";

/**
 * The signed shortcut this app serves (public/Michael.shortcut, made by `pnpm shortcut`). iOS names
 * an imported shortcut after its file, so the file keeps the name the Connect link runs.
 */
export const SHORTCUT_FILE = `/${SHORTCUT_NAME}.shortcut`;

/** Where "Add the shortcut" goes: the iCloud link in MICHAEL_SHORTCUT_URL if set, else our own file. Server only. */
export const shortcutUrl = () => process.env.MICHAEL_SHORTCUT_URL || SHORTCUT_FILE;

/**
 * Runs the installed Michael shortcut with the device key as its input. The shortcut saves the key
 * in its own file and from then on sends app opens with it. A shortcuts:// link stays on the phone.
 */
export const shortcutConnectLink = (key: string) =>
  `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}&input=text&text=${encodeURIComponent(key)}`;

export const isIPhone = (ua: string) => /iPhone|iPod/.test(ua);
export const isMac = (ua: string) => /Macintosh/.test(ua) && !/iPhone|iPad/.test(ua);

/** The body of the downloadable Michael.command: the same one line as the Copy button. */
export const macCommandFile = (installCommand: string) =>
  [
    "#!/bin/bash",
    "# Michael for Mac: installs and starts the collector. It only reads, and sends only to Michael.",
    "# This file works once, within 30 minutes of downloading it. After that, make a new one in Michael.",
    installCommand,
    "",
  ].join("\n");

// ---- a one file zip, so the .command keeps its "may run" permission ----
// Browsers drop the executable bit on downloads, and macOS refuses to open a .command without it.
// A zip records Unix permissions, and Safari and Archive Utility restore them when unzipping.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_DATE = (1 << 5) | 1; // 1 January 1980, the earliest a zip can say

/** A zip (stored, not compressed) holding one executable file. */
export function zipExecutable(name: string, content: string): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const fileName = enc.encode(name);
  const data = enc.encode(content);
  const crc = crc32(data);
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true); // local file header
  local.setUint16(4, 20, true); // version needed
  local.setUint16(8, 0, true); // stored
  local.setUint16(12, DOS_DATE, true);
  local.setUint32(14, crc, true);
  local.setUint32(18, data.length, true);
  local.setUint32(22, data.length, true);
  local.setUint16(26, fileName.length, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true); // central directory header
  central.setUint16(4, (3 << 8) | 20, true); // made by Unix, so the permissions below count
  central.setUint16(6, 20, true);
  central.setUint16(10, 0, true);
  central.setUint16(14, DOS_DATE, true);
  central.setUint32(16, crc, true);
  central.setUint32(20, data.length, true);
  central.setUint32(24, data.length, true);
  central.setUint16(28, fileName.length, true);
  central.setUint32(38, (0o100755 << 16) >>> 0, true); // regular file, rwxr-xr-x
  central.setUint32(42, 0, true); // offset of the local header
  const centralOffset = 30 + fileName.length + data.length;
  const centralSize = 46 + fileName.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralOffset, true);

  const out = new Uint8Array(centralOffset + centralSize + 22);
  let at = 0;
  for (const part of [
    new Uint8Array(local.buffer),
    fileName,
    data,
    new Uint8Array(central.buffer),
    fileName,
    new Uint8Array(end.buffer),
  ]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
