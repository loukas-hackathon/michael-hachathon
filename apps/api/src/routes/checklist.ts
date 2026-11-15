import { ChecklistItemCreate, ChecklistItemUpdate, ChecklistQuery } from "@michael/shared";
import { Hono } from "hono";
import { addItem, carryItem, checklistFor, deleteItem, todayOf, updateItem } from "../checklist/items";
import { offerGoalActions } from "../checklist/offers";
import { HttpError, jsonBody, parse } from "../http";
import { isLocalDay } from "../score";

// The day's outcomes of checklist goals (#238). The rules live in checklist/items.ts.
export const checklist = new Hono()
  // GET /v1/checklist?date=YYYY-MM-DD (default today in Europe/Athens)
  .get("/checklist", async (c) => {
    const q = parse(ChecklistQuery, { date: c.req.query("date") });
    const date = q.date ?? todayOf();
    if (!isLocalDay(date)) throw new HttpError("bad_request", "`date` must be a real day, YYYY-MM-DD");
    return c.json(await checklistFor(date));
  })
  .post("/checklist", async (c) => {
    const input = parse(ChecklistItemCreate, await jsonBody(c));
    if (input.date && !isLocalDay(input.date)) {
      throw new HttpError("bad_request", "`date` must be a real day, YYYY-MM-DD");
    }
    const item = await addItem(input);
    // The first open outcome of today gets an offered hour (checklist/offers.ts). An extra: a
    // failure here never loses the item.
    await offerGoalActions().catch((err) => console.error("checklist: offers", err));
    return c.json(item, 201);
  })
  .patch("/checklist/:id", async (c) => {
    const patch = parse(ChecklistItemUpdate, await jsonBody(c));
    const item = await updateItem(c.req.param("id"), patch, "user");
    await refreshOffers();
    return c.json(item);
  })
  .delete("/checklist/:id", async (c) => {
    await deleteItem(c.req.param("id"));
    await refreshOffers();
    return c.body(null, 204);
  })
  .post("/checklist/:id/carry", async (c) => {
    const carried = await carryItem(c.req.param("id"));
    await refreshOffers();
    return c.json(carried, 201);
  });

/** After an outcome changes: an offer that names a settled outcome is withdrawn at once. */
const refreshOffers = () => offerGoalActions().catch((err) => console.error("checklist: offers", err));
