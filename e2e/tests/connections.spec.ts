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
    // The second shortcut (#447), next to the first: Do Not Disturb, when you say yes.
    await expect(page.getByRole("link", { name: "Add Michael Focus" })).toHaveAttribute(
      "href",
      "/MichaelFocus.shortcut",
    );
    await expect(page.getByRole("button", { name: "Try it" })).toBeVisible();
  }
  await context.close();

  // Signed out (the QR setup page on a phone): the file itself, signed, named Michael.
  const file = await request.get("/Michael.shortcut", { maxRedirects: 0 });
  expect(file.status()).toBe(200);
  expect(file.headers()["content-disposition"]).toContain('filename="Michael.shortcut"');
  expect((await file.body()).subarray(0, 4).toString("latin1")).toBe("AEA1");
  // Michael Focus the same way: iOS names it after the download, and Michael runs it by that name.
  const focus = await request.get("/MichaelFocus.shortcut", { maxRedirects: 0 });
  expect(focus.status()).toBe(200);
  expect(focus.headers()["content-disposition"]).toContain('filename="Michael Focus.shortcut"');
  expect((await focus.body()).subarray(0, 4).toString("latin1")).toBe("AEA1");
});

// Do Not Disturb, asked then done (#447): the page a nudge's tap opens. With no nudge and nothing
// on, it says so plainly and switches nothing on.
test("Do Not Disturb: the hand over page opens and offers nothing without a nudge", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: "michael_e2e_user", value: randomUUID(), url: baseURL ?? "" }]);
  const page = await context.newPage();
  await page.goto(`${baseURL}/dnd`);
  await expect(page.getByRole("heading", { name: "Do Not Disturb" })).toBeVisible();
  await expect(page.getByText("Nothing to protect right now.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Switch it on" })).toHaveCount(0);
  await context.close();
});

// The installed app has no browser chrome (Loukas, 15 Nov): Add the shortcut opened the file in the
// app's own window and left him on a page with no way back. In standalone mode it opens a new page
// and this one stays put; the QR setup page has its own Close.
test("installed app: Add the shortcut opens a new page, /setup has Close", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "standalone", { get: () => true, configurable: true });
  });
  await context.addCookies([{ name: "michael_e2e_user", value: randomUUID(), url: baseURL ?? "" }]);
  const page = await context.newPage();

  await page.goto(`${baseURL}/you/connections/iphone`);
  const add = page.getByRole("link", { name: "Add the shortcut" });
  await expect(add).toHaveAttribute("target", "_blank");
  // The signed file opens as itself in Safari: never shortcuts://import-shortcut, which Shortcuts
  // refuses for a file URL ("Import Failed", Loukas' iPhone, 15 Nov).
  await expect(add).toHaveAttribute("href", /^https?:\/\/[^/]+\/Michael\.shortcut$/);
  const addHref = await add.getAttribute("href");
  const here = page.url();
  const opened = context.waitForEvent("page");
  await add.click();
  await (await opened).close();
  expect(page.url()).toBe(here);
  await expect(page.getByRole("button", { name: "Connect the shortcut" })).toBeVisible();

  // If Shortcuts does not open: steps in a sheet, Safari in a new page, and Done.
  await page.getByRole("button", { name: "Shortcuts did not open?" }).click();
  await expect(page.getByRole("link", { name: "Open in Safari" })).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "Open in Safari" })).toHaveAttribute("href", addHref ?? "");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("link", { name: "Open in Safari" })).toHaveCount(0);

  await page.goto(`${baseURL}/setup/iphone`);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/\/you\/connections\/iphone/);
  await context.close();
});

test("browser tab: /setup has no extra Close, the browser has its own back", async ({ page }) => {
  await page.goto("/setup/iphone");
  await expect(page.getByText("This link is not complete. Scan the code in Michael again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toHaveCount(0);
});
