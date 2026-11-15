import { type AppCategory, categoriseHost } from "@michael/shared";

// What a site is for, sent with each Chrome history visit as `data.category`. The one categoriser
// lives in packages/shared/src/categories.ts; the API, the web app and the browser extension
// (a generated copy) use the same lists, so a host gets the same category everywhere.
//
// Chrome's own category column (`content_annotations.categories`) is not usable for this: it holds
// opaque Knowledge Graph ids with a confidence ("/m/<id>:<0 to 100>"), the names for those ids are
// not on the machine, and it describes the topic of a page rather than what the site is for.

/**
 * The category of a host, or undefined when we do not know the site (search engines included: a
 * search page could be anything). Pass the bare host (see `hostFromUrl` in site-privacy.ts).
 */
export function siteCategory(host: string): AppCategory | undefined {
  const category = categoriseHost(host);
  return category === "other" ? undefined : category;
}
