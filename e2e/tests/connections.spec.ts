import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";

// Proving a Coming soon connection on production before it is switched on (#306): only the setup
// page opened with ?preview=1 shows the steps; everyone else, and the QR page without a token,
// sees Coming soon with nothing to tap.

test("Apple Watch: Coming soon everywhere, the steps only with ?preview=1", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: "michael_e2e_user", value: randomUUID(), url: baseURL ?? "" }]);

  await page.goto("/you/connections/apple-watch");
  await expect(page.getByText("Coming soon. I will tell you when it is ready.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show the code" })).toHaveCount(0);

  // On a laptop the preview offers the QR code that carries it to the iPhone.
  await page.goto("/you/connections/apple-watch?preview=1");
  await expect(page.getByText("Not connected")).toBeVisible();
  await expect(page.getByText(/Free for 7 days, then Premium/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Show the code" })).toBeVisible();

  // The QR page without a setup token stays Coming soon.
  await page.goto("/setup/apple-watch");
  await expect(page.getByText("Coming soon. I will tell you when it is ready.")).toBeVisible();
});
