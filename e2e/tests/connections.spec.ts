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

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// The Michael shortcut (#303): a signed file this app serves, added from the iPhone page. Still
// Coming soon for everyone; ?preview=1 shows the steps so it can be proven on a real iPhone.
test("iPhone: Coming soon, the shortcut steps only with ?preview=1, the signed file is public", async ({
  browser,
  request,
  baseURL,
}) => {
  const context = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: "michael_e2e_user", value: randomUUID(), url: baseURL ?? "" }]);
  const page = await context.newPage();

  await page.goto(`${baseURL}/you/connections/iphone`);
  await expect(page.getByText("Coming soon. I will tell you when it is ready.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add the shortcut" })).toHaveCount(0);

  await page.goto(`${baseURL}/you/connections/iphone?preview=1`);
  await expect(page.getByRole("link", { name: "Add the shortcut" })).toHaveAttribute(
    "href",
    "/Michael.shortcut",
  );
  await expect(page.getByRole("button", { name: "Connect the shortcut" })).toBeVisible();
  await context.close();

  // Signed out (the QR setup page on a phone): the file itself, signed, named Michael.
  const file = await request.get("/Michael.shortcut", { maxRedirects: 0 });
  expect(file.status()).toBe(200);
  expect(file.headers()["content-disposition"]).toContain('filename="Michael.shortcut"');
  expect((await file.body()).subarray(0, 4).toString("latin1")).toBe("AEA1");
});
