# Location: where you are on the timeline (#267)

## What works now, with no setup

- **This phone, when you open Michael.** After one tap on "Use this phone's location" on You >
  Connections > Location (never on launch), each open sends at most one position every 10 minutes,
  and only while the browser already allows it.
- **Calendar.** An event at a saved place counts as planned presence when nothing else says
  otherwise. It is never stored as a visit; chat and agents read it as "planned in the calendar,
  not confirmed".

Signals become **visits** in the API (`apps/api/src/location/visits.ts`): within about 150 m of a
saved place the place is named; elsewhere only "Out" or the overlapping calendar location is kept,
rounded to about a kilometre, never a trail. Visits show as a quiet caption on the Timeline ("Gym
18:05 to 19:20"), back goals in the score (gym time for training, work or university time for
business), and reach the chat and MCP `get_timeline`. The demo week has work, university and gym
visits so the stage shows them.

Demo visitors cannot send positions (the API answers 403); that is intended.

The connection stays **Coming soon** (`CONNECTOR_STATUS.travel`) until it is proven end to end on
production; `?preview=1` on its page shows it as live for that proof.

## Not in this version

The Mac's Wi-Fi as a signal was cut for the hackathon to keep scope small: location comes from the
phone and the calendar only.

## Next

1. A Shortcuts automation ("When I arrive at / leave Home") posting to `/v1/location/signals` with a
   device key: exact arrivals without the app open, about a minute per place to set up.
2. A native app or App Clip with significant location changes, for a full day without opening
   anything.
3. Apple Watch workout locations, so a run or a swim names where it happened.

## For the pitch

Michael knows where your hours went, not only what was on your screen: at the gym, at work, or
out. It asks once, keeps only your own places by name, and never keeps a trail.
