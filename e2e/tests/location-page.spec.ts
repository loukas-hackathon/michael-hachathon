import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";

// The Location page hydrates cleanly for a new user (QA walk, Sun 15 Nov): the "I am at home now"
// button was left out of the server HTML (Node has a navigator without geolocation), so React threw
// #418 and re-rendered the page. The fixtures' guard fails this test on that page error.
test("Location opens with no hydration error and offers the one tap place", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: "michael_e2e_user", value: randomUUID(), url: baseURL ?? "" }]);
  await page.goto("/you/connections/travel");
  await expect(page.getByRole("button", { name: "Use this phone's location" })).toBeVisible();
  await expect(page.getByRole("button", { name: "I am at home now" })).toBeVisible();
  await page.waitForLoadState("networkidle");
});
