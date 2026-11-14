import { copyFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Apps keep their databases locked while they run, so we never open the live file.
 * Copy it (with its -wal, -shm and -journal sidecars) and open the copy read-only.
 */
export function openCopy(path: string, tmpDir: string): DatabaseSync {
  if (!existsSync(path)) throw new Error(`Not found: ${path}`);
  const target = join(tmpDir, `${Date.now()}-${basename(path)}`);
  try {
    copyFileSync(path, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") {
      throw new Error(
        `No permission to read ${path}. Give Full Disk Access to the app that runs the collector ` +
          "(System Settings, Privacy and Security, Full Disk Access), then run it again.",
      );
    }
    throw error;
  }
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    if (existsSync(path + suffix)) copyFileSync(path + suffix, target + suffix);
  }
  return new DatabaseSync(target, { readOnly: true });
}

/** Seconds between the Unix epoch and Apple's reference date (2001-01-01). */
export const APPLE_EPOCH_OFFSET = 978_307_200;

export const appleSecondsToIso = (seconds: number) =>
  new Date((seconds + APPLE_EPOCH_OFFSET) * 1000).toISOString();
