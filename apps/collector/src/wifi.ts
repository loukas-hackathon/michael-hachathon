import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

// Where the Mac is, as the Wi-Fi network it is on (#267, docs/location.md). Sent each pass to
// POST /v1/location/signals; the API turns it into place visits ("Office 09:10 to 18:05").
//
// The network id is a hash of the router's hardware address (the default gateway's MAC), so it is
// stable and says nothing by itself. macOS 14.4 and later hide the network name from command line
// tools without Location access, so the name is sent only when the Mac gives it.

const run = promisify(execFile);

export interface WifiReading {
  network: string;
  name: string | null;
}

/** `route -n get default`: the gateway address and its interface. */
export function parseRoute(out: string): { gateway: string; iface: string | null } | null {
  const gateway = /^\s*gateway:\s*(\S+)/m.exec(out)?.[1];
  if (!gateway || !/^\d{1,3}(\.\d{1,3}){3}$/.test(gateway)) return null;
  return { gateway, iface: /^\s*interface:\s*(\S+)/m.exec(out)?.[1] ?? null };
}

/** `arp -n <ip>`: the hardware address, normalised to two hex digits per byte. */
export function parseArp(out: string): string | null {
  const mac = /\sat\s+([0-9a-f]{1,2}(?::[0-9a-f]{1,2}){5})\s/i.exec(out)?.[1];
  if (!mac) return null;
  return mac
    .toLowerCase()
    .split(":")
    .map((b) => b.padStart(2, "0"))
    .join(":");
}

/** `networksetup -getairportnetwork en0`: the network name, unless macOS redacts it. */
export function parseAirport(out: string): string | null {
  const name = /Current Wi-Fi Network:\s*(.+)$/m.exec(out)?.[1]?.trim();
  return name && name !== "<redacted>" ? name.slice(0, 64) : null;
}

export const networkId = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 16);

const quiet = async (cmd: string, args: string[]) => {
  try {
    return (await run(cmd, args, { timeout: 5000 })).stdout;
  } catch {
    return "";
  }
};

/** The network this Mac is on now, or null (not a Mac, offline, or nothing readable). */
export async function readWifi(): Promise<WifiReading | null> {
  if (process.platform !== "darwin") return null;
  const route = parseRoute(await quiet("route", ["-n", "get", "default"]));
  const iface = route?.iface ?? "en0";
  const mac = route ? parseArp(await quiet("arp", ["-n", route.gateway])) : null;
  const name = parseAirport(await quiet("networksetup", ["-getairportnetwork", iface]));
  const key = mac ?? name;
  if (!key) return null;
  return { network: networkId(key), name };
}
