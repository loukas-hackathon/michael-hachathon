import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import {
  API_URL,
  apiGet,
  enterDemo,
  expect,
  fillReady,
  onTheRecord,
  PRESENTER_KEY,
  tap,
  test,
} from "./fixtures";
import { live, stubSpeech, voice } from "./speech-stub";

// Onboarding is a hands free talk with Michael, run here with the scripted recogniser and the
// recording speech synthesiser from speech-stub.ts. The API in e2e has no model key, so his lines
// come from a script (the API's, or the app's own when the turn endpoint is not there), and the
// answers are read into goals by word lists. Nothing below depends on the exact questions.

const review = (page: Page) =>
  page.getByRole("heading", { name: /^(Here's what I heard\.|I need a little more\.)$/ });

/** Skips whatever Michael still asks until the review is on screen. */
async function untilReview(page: Page) {
  await expect(async () => {
    if (await review(page).isVisible()) return;
    await page.getByRole("button", { name: "Skip this one" }).click({ timeout: 1000 });
    throw new Error("still talking");
  }).toPass({ timeout: 20_000 });
}

/** Past the intro (said out loud on the first tap) and, when asked, the calendar ("Not now"). */
async function intoTheTalk(page: Page) {
  await expect(page.getByText("I'm Michael.")).toBeVisible();
  await tap(page.getByRole("button", { name: "Let's talk" }));
  const notNow = page.getByRole("button", { name: "Not now" });
  await expect(notNow.or(page.getByTestId("talk-orb"))).toBeVisible();
  if (await notNow.isVisible()) await tap(notNow);
  await expect(page.getByTestId("michael-line")).not.toBeEmpty();
}

// A fresh, non demo user: Today sends them to onboarding, the talk, what Michael heard, the
// connections, and Today takes them in.
// The test sign in (cookie michael_e2e_user) only works with E2E_TEST_AUTH=on on the in-memory API.
test("onboarding completes for a fresh user, by voice and by keyboard", async ({
  page,
  context,
  baseURL,
}) => {
  await stubSpeech(page);
  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
  const asUser = async <T>(path: string, method = "GET"): Promise<T> => {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { authorization: `Bearer e2e_${user}` },
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
    return (await res.json()) as T;
  };
  // The in-memory store hands every new user the sample day; deleting it leaves the empty account a
  // real first sign in has (and checks that deletion really deletes).
  await asUser("/v1/me/data", "DELETE");

  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
  // The first tap: Michael says his intro, then offers to read the calendar first.
  await expect(page.getByText("I'm Michael.")).toBeVisible();
  await tap(page.getByRole("button", { name: "Let's talk" }));
  await expect(page.getByRole("heading", { name: "Want me to look at your calendar first?" })).toBeVisible();
  expect((await voice<string[]>(page, "v.spoken")).join(" ")).toContain("I'm Michael.");
  await expect(page.getByRole("link", { name: "Connect Google Calendar" })).toHaveAttribute(
    "href",
    "/integrations/google/connect?return_to=%2Fonboarding%3Fstep%3Dtalk",
  );
  await tap(page.getByRole("button", { name: "Not now" }));

  // The talk: he asks out loud, then listens on his own.
  const orb = page.getByTestId("talk-orb");
  await expect(orb).toHaveAttribute("data-state", "listening");
  await expect.poll(() => live(page)).toBe(1);
  const first = (await page.getByTestId("michael-line").textContent()) ?? "";
  expect((await voice<string[]>(page, "v.spoken")).join(" ")).toContain(first.split(" ").slice(-3).join(" "));
  // The words show as they are said; the pause after them ends the turn.
  await voice(page, `r.say("mostly the startup")`);
  await expect(page.getByTestId("live-words")).toHaveText("mostly the startup");
  await expect(page.getByTestId("michael-line")).not.toHaveText(first);
  await expect(orb).toHaveAttribute("data-state", "listening");

  // Misheard or half said: a tap on the answer fixes it, and the fixed words are what count.
  await tap(page.getByRole("button", { name: /^You said: mostly the startup/ }));
  await fillReady(
    page.getByLabel("Fix what I heard"),
    "um mostly the startup, ten hours of deep work, and get back to the gym three times a week",
  );
  await tap(page.getByRole("button", { name: "Save" }));
  await expect(page.getByRole("button", { name: /^You said: um mostly the startup/ })).toBeVisible();

  // Nothing to add: skip it. A noisy room: type the rest.
  await tap(page.getByRole("button", { name: "Skip this one" }));
  await expect(orb).toHaveAttribute("data-state", "listening");
  await tap(page.getByRole("button", { name: "Type instead" }));
  await fillReady(page.getByLabel("Your answer"), "I lose my evenings on my phone");
  await tap(page.getByRole("button", { name: "Send" }));
  await untilReview(page);

  // What he heard: no model key in CI, so the word lists read it. Hours said are kept as said.
  await expect(page.getByRole("heading", { name: "Here's what I heard." })).toBeVisible();
  const heard = page.getByRole("list", { name: "Goals I heard" });
  // The startup and its ten hours of deep work are one goal, not two.
  await expect(heard.getByRole("textbox", { name: "Goal name" })).toHaveCount(2);
  await expect(heard.getByText("10h a week")).toBeVisible();
  await expect(heard.getByText("3h a week")).toBeVisible();
  await expect(page.getByRole("region", { name: "What I'll remember" })).toContainText(
    "I lose my evenings on my phone",
  );
  await tap(page.getByRole("button", { name: "Keep these two" }));

  await expect(page.getByRole("heading", { name: "Now, your days." })).toBeVisible();
  // Everything that adds to the day is offered, each with Connect; nudges wait for a moment (#207).
  const offer = page.getByRole("region", { name: "Connections" });
  for (const name of ["Google Calendar", "Apple Watch", "Mac", "iPhone", "Location", "Claude"])
    await expect(offer.getByText(name, { exact: true })).toBeVisible();
  await expect(offer.getByRole("link", { name: "Connect", exact: true })).toHaveCount(6);
  await expect(page.getByText("Coming soon")).toHaveCount(0);
  await tap(page.getByRole("link", { name: "Go to Today" }));

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: /^(Morning|Today|Evening)$/ })).toBeVisible();

  // Saved for this user only, never on the demo account.
  const { goals } = await asUser<{ goals: { title: string }[] }>("/v1/goals");
  expect(goals.map((g) => g.title).sort()).toEqual(["Ship the product", "Training"]);
  const profile = await asUser<{ onboarded_at: string | null }>("/v1/profile");
  expect(profile.onboarded_at).not.toBeNull();

  // House rules are one tap on You (#190), and leave the suggestions once added.
  await page.goto("/you");
  await tap(page.getByRole("button", { name: "Add: Keep Sundays clear" }));
  await expect(page.getByRole("button", { name: "Add: Keep Sundays clear" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Keep Sundays clear" })).toBeChecked();
});

// Redo setup on the demo week, on a device that cannot listen: the talk goes to the keyboard by
// itself, said kindly, and the visitor walks it to the end; nothing is written (#239).
test("a demo visitor without a microphone types the talk to the end", async ({ page }) => {
  await stubSpeech(page, { recognition: false });
  await enterDemo(page);
  await page.goto("/onboarding");
  await intoTheTalk(page);
  await expect(page.getByText("I can't hear you on this device.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Type instead" })).toHaveCount(0);
  await fillReady(page.getByLabel("Your answer"), "Study for my exams and train twice a week");
  await tap(page.getByRole("button", { name: "Send" }));
  await untilReview(page);
  await expect(page.getByRole("heading", { name: "Here's what I heard." })).toBeVisible();
  await tap(page.getByRole("button", { name: /^Keep (this goal|these .+)$/ }));
  await expect(page.getByRole("heading", { name: /^(Here's your week\.|Now, your days\.)$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Today" })).toBeVisible();
});

// The usual list stays one tap away: "Pick from the usual" when the talk heard nothing.
test("skipping every question offers the usual goals", async ({ page }) => {
  await stubSpeech(page);
  await enterDemo(page);
  await page.goto("/onboarding");
  await intoTheTalk(page);
  await untilReview(page);
  await expect(page.getByRole("heading", { name: "I need a little more." })).toBeVisible();
  await tap(page.getByRole("link", { name: "Pick from the usual" }));
  await expect(
    page.getByRole("heading", { name: /^(What are we playing for\?|Here's what your week is for\.)$/ }),
  ).toBeVisible();
});

// Back from Google the talk is one clear tap away (a phone needs a fresh tap for sound), and a
// calendar that did not connect never blocks it.
test("back from Google: one tap starts the talk", async ({ page }) => {
  await stubSpeech(page);
  await enterDemo(page);
  await page.goto("/onboarding?step=talk&integration_error=google_calendar");
  await expect(page.getByRole("heading", { name: "Your calendar didn't connect." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
  await page.goto("/onboarding?step=talk&connected=google_calendar");
  await expect(page.getByRole("heading", { name: "Got your calendar." })).toBeVisible();
  await tap(page.getByRole("button", { name: "Start talking" }));
  await expect(page.getByTestId("talk-orb")).toHaveAttribute("data-state", "listening");
});

// Every connection is a row on You with Connect and a real status (Loukas, Sun 15 Nov), and each
// Connect opens a working setup page.
test("You shows all eight connections, each with Connect", async ({ page, context, baseURL }) => {
  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
  // An empty account: nothing connected yet.
  await fetch(`${API_URL}/v1/me/data`, {
    method: "DELETE",
    headers: { authorization: `Bearer e2e_${user}` },
  });
  await page.goto("/you");
  const list = page.locator("#connections");
  const names = [
    "Google Calendar",
    "Apple Watch",
    "Mac",
    "iPhone",
    "Claude",
    "Nudges",
    "Telegram",
    "Location",
  ];
  for (const name of names)
    await expect(list.getByRole("link", { name: new RegExp(`^${name} `) })).toBeVisible();
  await expect(list.getByText("Coming soon")).toHaveCount(0);
  await expect(list.getByRole("link", { name: "Connect", exact: true })).toHaveCount(
    await list.getByText("Not connected").count(),
  );
  expect(await list.getByRole("link", { name: /^(Connect|Manage)$/ }).count()).toBe(8);

  // The device rows open their real setup steps, never Coming soon.
  await tap(list.getByRole("link", { name: /Apple Watch/ }));
  await expect(page).toHaveURL(/\/you\/connections\/apple-watch/);
  await expect(page.getByText(/Free for 7 days, then Premium/)).toBeVisible();
  await expect(page.getByText("Coming soon. I will tell you when it is ready.")).toHaveCount(0);
});

// The demo week replays recorded sources, so a demo visitor sees them as what they are, and a tap
// the API refuses says the one demo line next to the control (#330).
test("You on the demo week: sources read Sample data, a refused tap says why", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/you");
  const list = page.locator("#connections");
  await expect(
    list.getByText(
      "The demo week replays calendar, Mac, iPhone and watch data. Your own connections start off.",
    ),
  ).toBeVisible();
  await expect(list.getByText("Sample data", { exact: true })).toHaveCount(4);
  await expect(list.getByRole("link", { name: /Google Calendar|Apple Watch|Mac|iPhone/ })).toHaveCount(0);

  const privacy = page.locator("section", { has: page.getByRole("heading", { name: "Privacy" }) });
  await expect(async () => {
    await page.locator("#off-the-record").click();
    await expect(
      privacy.getByText("This is the demo week. Sign in with Google to make it yours."),
    ).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.locator("#off-the-record")).not.toBeChecked();
});

test("the presenter: no sign in lines on the projector, Off the record switches on and off", async ({
  page,
}) => {
  await page.goto(`/auth/presenter?key=${PRESENTER_KEY}`);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Sign in to make it yours.")).toHaveCount(0);

  await page.goto("/you");
  await expect(page.getByText("Sign in with Google to make it yours.")).toHaveCount(0);
  const record = page.locator("#off-the-record");
  const offTheRecord = async () => (await apiGet<{ off_the_record: boolean }>("/v1/privacy")).off_the_record;
  // One tap each way, each waiting for the server: a double tap would leave the shared demo
  // account off the record and refuse every later write.
  // The switch is disabled while a save is in flight, so the second tap waits for the first save.
  try {
    await tap(record);
    await expect(page.getByText(/^Nothing is being collected/)).toBeVisible();
    await expect.poll(offTheRecord).toBe(true);
    await expect(record).toBeEnabled();
    await tap(record);
    await expect(page.getByText("Collecting from your connections.")).toBeVisible();
    await expect.poll(offTheRecord).toBe(false);
    await expect(record).not.toBeChecked();
  } finally {
    // Whatever happened above, the next test gets the demo account on the record (#402).
    await onTheRecord();
  }
});
