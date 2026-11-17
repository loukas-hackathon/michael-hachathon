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

// The shared iCloud links (Loukas, 15 Nov): Add opens Shortcuts on Add Shortcut, no browser.
const MICHAEL_ICLOUD = "https://www.icloud.com/shortcuts/c0c2a08d12f74e5392e41b195ba2bd57";
const FOCUS_ICLOUD = "https://www.icloud.com/shortcuts/76e297e86ff742dfb3446679fb46932d";

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
      MICHAEL_ICLOUD,
    );
    await expect(page.getByRole("button", { name: "Connect the shortcut" })).toBeVisible();
    await expect(page.getByText("Coming soon. I will tell you when it is ready.")).toHaveCount(0);
    // The second shortcut (#447), next to the first: Do Not Disturb, when you say yes.
    await expect(page.getByRole("link", { name: "Add Michael Focus" })).toHaveAttribute("href", FOCUS_ICLOUD);
    await expect(page.getByRole("button", { name: "Try it" })).toBeVisible();
  }
  await context.close();

  // Signed out (the QR setup page on a phone): the file itself, signed, named Michael.
  const file = await request.get("/Michael.shortcut", { maxRedirects: 0 });
  expect(file.status()).toBe(200);
  // Inline as Apple's shortcut type, so iOS previews it with Open in Shortcuts, never saves it to Files.
  expect(file.headers()["content-type"]).toBe("application/x-apple-shortcut");
  expect(file.headers()["content-disposition"]).toBe('inline; filename="Michael.shortcut"');
  expect((await file.body()).subarray(0, 4).toString("latin1")).toBe("AEA1");
  // Michael Focus the same way: iOS names it after the download, and Michael runs it by that name.
  const focus = await request.get("/MichaelFocus.shortcut", { maxRedirects: 0 });
  expect(focus.status()).toBe(200);
  expect(focus.headers()["content-type"]).toBe("application/x-apple-shortcut");
  expect(focus.headers()["content-disposition"]).toBe('inline; filename="Michael Focus.shortcut"');
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

// The installed app (Loukas, 15 Nov): Add opens the iCloud link in a new context, which Shortcuts
// takes over. The fallback is our own file in the app's own window, where iOS shows its preview
// with Open in Shortcuts (a new context for the file stayed blank, #497, #508). Coming back, the
// steps read as they were; /setup has its own Close.
test("installed app: Add opens iCloud, the file is the fallback, the steps survive the trip", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "standalone", { get: () => true, configurable: true });
  });
  await context.addCookies([{ name: "michael_e2e_user", value: randomUUID(), url: baseURL ?? "" }]);
  const page = await context.newPage();

  await page.goto(`${baseURL}/you/connections/iphone`);
  await expect(page.getByText("Add the shortcut first, then connect it here.")).toBeVisible();
  const add = page.getByRole("link", { name: "Add the shortcut" });
  await expect(add).toHaveAttribute("href", MICHAEL_ICLOUD);
  await expect(add).toHaveAttribute("target", "_blank");
  const focus = page.getByRole("link", { name: "Add Michael Focus" });
  await expect(focus).toHaveAttribute("href", FOCUS_ICLOUD);
  await expect(focus).toHaveAttribute("target", "_blank");
  const focusFile = page.getByRole("link", { name: "Shortcuts did not open? Open the file" });
  await expect(focusFile).toHaveAttribute("href", "/MichaelFocus.shortcut");
  await expect(focusFile).not.toHaveAttribute("target", /.+/);

  // Shortcuts did not open: our own file, in this window.
  await page.getByRole("button", { name: "Shortcuts did not open?" }).click();
  const file = page.getByRole("link", { name: "Open the shortcut file" });
  await expect(file).toHaveAttribute("href", "/Michael.shortcut");
  await expect(file).not.toHaveAttribute("target", /.+/);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(file).toHaveCount(0);

  // The tap marks the step; the file itself is iOS' business. Back in Michael, nothing is lost.
  await add.evaluate((a) => a.addEventListener("click", (e) => e.preventDefault()));
  await add.click();
  await expect(
    page.getByText("Connect it to you. Shortcuts opens for a second and says Connected."),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Connect it to you. Shortcuts opens for a second and says Connected."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect the shortcut" })).toBeVisible();

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
