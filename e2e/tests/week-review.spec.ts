import { apiGet, enterDemo, expect, tap, test } from "./fixtures";

// Your week (#376) on the demo week: opened from Today, it shows the review's own numbers (the
// score, Michael's lesson, each goal) and Plan next week books the first block, then Undo takes it
// back so the demo week is left as it was.

type Review = {
  score: { pct: number | null };
  lesson: string;
  goals: { title: string }[];
  next_move: { status: "book" | "booked"; title: string } | null;
};

test("Your week opens from Today with the maths, and Plan next week books and undoes", async ({ page }) => {
  await enterDemo(page);
  const review = await apiGet<Review>("/v1/week/review");

  // Sunday evening leads with the review; every other time it is a row under More from Michael.
  await tap(page.getByRole("link", { name: /Your week/ }).first());
  await expect(page).toHaveURL(/\/week$/);
  await expect(page.getByRole("heading", { level: 1, name: "Your week" })).toBeVisible();

  if (review.score.pct !== null) {
    await expect(page.getByRole("region", { name: "The week's score" })).toContainText(
      `${review.score.pct}%`,
    );
  }
  await expect(page.getByText(review.lesson, { exact: true })).toBeVisible();
  const goals = page.getByRole("region", { name: "Goals" });
  for (const g of review.goals) await expect(goals.getByText(g.title, { exact: true })).toBeVisible();

  const next = page.getByRole("region", { name: "Next week" });
  if (review.next_move?.status === "book") {
    await expect(next.getByText(`${review.next_move.title}.`)).toBeVisible();
    await tap(next.getByRole("button", { name: "Plan next week" }));
    await expect(next.getByRole("status")).toContainText("Booked");
    await tap(next.getByRole("button", { name: "Undo" }));
    await expect(next.getByRole("status")).toContainText("Undone");
  } else {
    await expect(next.getByRole("link", { name: "Plan next week" })).toHaveAttribute("href", "/goals");
  }
});
