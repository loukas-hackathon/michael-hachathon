import { createHash, randomBytes } from "node:crypto";
import { SETUP_KEY_NAMES, SetupConnection } from "@michael/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { currentUserId, runAsUser } from "./context";
import { env } from "./env";
import { HttpError } from "./http";
import { createPersonalToken } from "./tokens";

// Setup tokens (#120): "ms_<43 url-safe chars>", valid 30 minutes, exchanged once for a device key.
// They are what a QR code, an install command or a downloaded .command file carries, so the long
// lived device key never sits in a URL, a shell history or a Downloads folder. Only the sha256 is
// stored; the exchange marks the row used in the same statement that reads it, so it works once.
export const SETUP_PREFIX = "ms_";
export const SETUP_TTL_MS = 30 * 60_000;
const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");

interface Row {
  user_id: string;
  connection: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
}

interface SetupBackend {
  insert(row: Omit<Row, "used_at">): Promise<void>;
  /** Marks an unused, unexpired token used and returns it; null if there is none. Atomic. */
  claim(tokenHash: string, now: Date): Promise<Row | null>;
  /** Really deletes every setup token of the user (DELETE /v1/me/data). */
  deleteAll(userId: string): Promise<void>;
}

class MemorySetup implements SetupBackend {
  private rows: Row[] = [];
  async insert(r: Omit<Row, "used_at">) {
    this.rows.push({ ...r, used_at: null });
  }
  async claim(h: string, now: Date) {
    const r = this.rows.find((x) => x.token_hash === h && !x.used_at && new Date(x.expires_at) > now);
    if (!r) return null;
    r.used_at = now.toISOString();
    return r;
  }
  async deleteAll(userId: string) {
    this.rows = this.rows.filter((r) => r.user_id !== userId);
  }
}

class SupabaseSetup implements SetupBackend {
  constructor(private db: SupabaseClient) {}
  async insert(r: Omit<Row, "used_at">) {
    const { error } = await this.db.from("setup_tokens").insert(r);
    if (error) throw new HttpError("upstream_error", `Database error: ${error.message}`);
  }
  async claim(h: string, now: Date) {
    // One UPDATE ... WHERE used_at IS NULL: two exchanges racing for one token cannot both win.
    const { data, error } = await this.db
      .from("setup_tokens")
      .update({ used_at: now.toISOString() })
      .eq("token_hash", h)
      .is("used_at", null)
      .gt("expires_at", now.toISOString())
      .select("user_id, connection, token_hash, expires_at, used_at");
    if (error) throw new HttpError("upstream_error", `Database error: ${error.message}`);
    return ((data ?? []) as Row[])[0] ?? null;
  }
  async deleteAll(userId: string) {
    const { error } = await this.db.from("setup_tokens").delete().eq("user_id", userId);
    if (error) throw new HttpError("upstream_error", `Database error: ${error.message}`);
  }
}

const backend: SetupBackend =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? new SupabaseSetup(
        createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }),
      )
    : new MemorySetup();

/** Mints a setup token for the current user and one connection. The secret is returned once. */
export async function createSetupToken(connection: SetupConnection, now = new Date()) {
  const token = SETUP_PREFIX + randomBytes(32).toString("base64url");
  const expires_at = new Date(now.getTime() + SETUP_TTL_MS).toISOString();
  await backend.insert({ user_id: currentUserId(), connection, token_hash: hash(token), expires_at });
  return { token, expires_at };
}

/**
 * Swaps a setup token for a new device key for the token's user and connection. Throws 401 when the
 * token is unknown, used or expired (one message for all three, so it reveals nothing).
 */
export async function exchangeSetupToken(token: string, now = new Date()) {
  const row = token.startsWith(SETUP_PREFIX) ? await backend.claim(hash(token), now) : null;
  const connection = row ? SetupConnection.safeParse(row.connection) : null;
  if (!row || !connection?.success) {
    throw new HttpError(
      "unauthorized",
      "This setup link has expired or was used. Make a new one in Michael.",
    );
  }
  const { secret } = await runAsUser(row.user_id, () =>
    createPersonalToken(SETUP_KEY_NAMES[connection.data]),
  );
  return { connection: connection.data, secret };
}

/** Deletes every setup token of the current user. */
export async function deleteAllSetupTokens() {
  await backend.deleteAll(currentUserId());
}
