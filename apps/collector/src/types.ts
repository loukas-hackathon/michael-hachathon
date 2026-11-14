import type { EventInput, Source } from "@michael/shared";

export type ReaderContext = {
  /** Opaque position from the previous run of this reader, or null on the first run. */
  cursor: string | null;
  /** How far back to read on the first run. */
  backfillDays: number;
  /** Scratch folder for copies of locked database files. Emptied after each run. */
  tmpDir: string;
  log: (message: string) => void;
};

export type ReaderResult = {
  events: EventInput[];
  /** Saved only after the events were posted successfully. */
  cursor: string | null;
};

/**
 * One reader per local data source. A reader never writes to the files it reads, never posts
 * anything itself, and must give every event a stable `external_id` so re-runs are harmless.
 */
export type Reader = {
  /** Name used on the command line and in the cursor file. */
  name: string;
  source: Source;
  /** One line for `--list`: what it reads and what permission it needs. */
  describe: string;
  read: (ctx: ReaderContext) => Promise<ReaderResult>;
};
