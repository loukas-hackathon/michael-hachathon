import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";

// Every connection is live (Loukas, Sun 15 Nov): its setup page shows the real steps to everyone.
// ?preview=1 is no longer needed, and stays harmless.

test("Apple Watch: the setup steps show for everyone, with or without ?preview=1", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: "michael_e2e_user", value: randomUUID(), url: baseURL ?? "" }]);

  for (const path of ["/you/connections/apple-watch", "/you/connections/apple-watch?preview=1"]) {
    await page.goto(path);
    await expect(page.getByText("Not connected")).toBeVisible();
    await expect(page.getByText(/Free for 7 days, then Premium/)).toBeVisible();
    // On a laptop the QR code carries it to the iPhone.
    await expect(page.getByRole("button", { name: "Show the code" })).toBeVisible();
    await expect(page.getByText("Coming soon. I will tell you when it is ready.")).toHaveCount(0);
  }

  // The QR page without a setup token asks for the code again, never a dead end.
  await page.goto("/setup/apple-watch");
  await expect(page.getByText("This link is not complete. Scan the code in Michael again.")).toBeVisible();
});

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// The Michael shortcut (#303): a signed file this app serves, added from the iPhone page, live for
// everyone; ?preview=1 changes nothing.
test("iPhone: the shortcut steps show for everyone, the signed file is public", async ({
  browser,
  request,
  baseURL,
}) => {
  const context = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: "michael_e2e_user", value: randomUUID(), url: baseURL ?? "" }]);
  const page = await context.newPage();

  for (const path of ["/you/connections/iphone", "/you/connections/iphone?preview=1"]) {
    await page.goto(`${baseURL}${path}`);
    await expect(page.getByRole("link", { name: "Add the shortcut" })).toHaveAttribute(
      "href",
      "/Michael.shortcut",
    );
    await expect(page.getByRole("button", { name: "Connect the shortcut" })).toBeVisible();
    await expect(page.getByText("Coming soon. I will tell you when it is ready.")).toHaveCount(0);
  }
  await context.close();

  // Signed out (the QR setup page on a phone): the file itself, signed, named Michael.
  const file = await request.get("/Michael.shortcut", { maxRedirects: 0 });
  expect(file.status()).toBe(200);
  expect(file.headers()["content-disposition"]).toContain('filename="Michael.shortcut"');
  expect((await file.body()).subarray(0, 4).toString("latin1")).toBe("AEA1");
});
