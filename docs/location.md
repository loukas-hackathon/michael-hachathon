# Location: where you are on the timeline (#267)

## What works now, with no setup

- **Mac Wi-Fi.** The collector reports the network it is on each pass. On You > Connections >
  Location, one tap says "This is Home's Wi-Fi" (or Work, Gym); from then on time on that network is
  a visit to that place.
- **This phone, when you open Michael.** After one tap on "Use this phone's location" on the
  Location page (never on launch), each open sends at most one position every 10 minutes, and only
  while the browser already allows it.
- **Calendar.** An event at a saved place counts as planned presence when nothing else says
  otherwise.

Signals become **visits** in the API (`apps/api/src/location/visits.ts`): within about 150 m of a
saved place the place is named; elsewhere only "Out" or the overlapping calendar location is kept,
never a trail. Visits show as a quiet label on the Timeline, back goals in the score (gym time for
training, work or university time for business), and reach the chat and MCP `get_timeline`.

The connection stays **Coming soon** (`CONNECTOR_STATUS.travel`) until it is proven end to end on
production; `?preview=1` on its page shows it as live for that proof.

## Next

1. A Shortcuts automation ("When I arrive at / leave Home") posting to `/v1/location/signals`:
   exact arrivals without the app open.
2. A native app with significant location changes, for a full day without opening anything.
3. Apple Watch workout locations, so a run or a swim names where it happened.

## For the pitch

Michael knows where your hours went, not only what was on your screen: at the gym, at work, or
out. It asks once, keeps only your own places by name, and never keeps a trail.
