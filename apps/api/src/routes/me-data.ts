import { DataDeleteQuery, type DataDeleteResult } from "@michael/shared";
import { Hono } from "hono";
import { deleteAuthUser } from "../auth";
import { currentAuthMethod, currentUserId } from "../context";
import { env } from "../env";
import { HttpError, parse } from "../http";
import { revokeToken } from "../integrations/google";
import { deleteAllSetupTokens } from "../setup-tokens";
import { store } from "../store";
import { deleteAllPersonalTokens } from "../tokens";

// "Deletion really deletes" (#47, AGENTS.md Privacy). DELETE /v1/me/data removes every row of the
// signed-in person, revokes Google's calendar access and deletes the sign in itself. With source,
// from or to it only removes the matching timeline events and their summaries.
export const meData = new Hono().delete("/me/data", async (c) => {
  // Only the person, signed in to the app. Device keys, agents and the demo API key can never wipe data.
  if (currentAuthMethod() !== "session") {
    throw new HttpError("forbidden", "Sign in to the app to delete your data");
  }
  const userId = currentUserId();
  if (userId === env.DEMO_USER_ID) {
    throw new HttpError(
      "forbidden",
      "The demo account can't be deleted. Reseed it with POST /v1/demo/reseed",
    );
  }
  const q = parse(DataDeleteQuery, {
    source: c.req.query("source") || undefined,
    from: c.req.query("from") || undefined,
    to: c.req.query("to") || undefined,
  });
  const everything = !q.source && !q.from && !q.to;

  let googleRevoked = false;
  if (everything) {
    // Revoke at Google first, while we still hold the token.
    const rec = await store.getIntegration("google_calendar");
    const token = rec?.refresh_token ?? rec?.access_token;
    if (token) {
      await revokeToken(token);
      googleRevoked = true;
    }
  }

  const deleted = await store.deleteMyData({ everything, ...q });
  if (everything) {
    deleted.personal_tokens = await deleteAllPersonalTokens();
    await deleteAllSetupTokens();
  }
  const accountDeleted = everything ? await deleteAuthUser(userId) : false;

  const body: DataDeleteResult = {
    scope: everything ? "everything" : "timeline",
    deleted,
    total: Object.values(deleted).reduce((a, b) => a + b, 0),
    google_revoked: googleRevoked,
    account_deleted: accountDeleted,
  };
  console.log(`[me/data] ${body.scope} deleted for ${userId}: ${body.total} rows`);
  return c.json(body);
});
