# Demo: talk to Michael by voice

Two ways to talk to Michael on stage. Both run on free tools.

1. **Claude voice mode with the Michael connector** (no code of ours on the path, most reliable).
2. **Push to talk in the app** (`/chat`, the mic button next to Send).

Rehearse both. If the venue wifi is bad, lead with the app (browser speech works offline for the
voice out; recognition needs a connection on most phones).

## Before the pitch (10 minutes)

- [ ] Phone: Claude app signed in to the demo account, Michael connector added and allowed
      (claude.ai, Settings, Connectors, Add custom connector, paste the MCP URL from the README
      "Live services", tap Allow on Michael's consent page). The phone app shares connectors with claude.ai.
- [ ] In a new Claude chat, type "What tools do you have from Michael?" and check it lists
      `get_timeline`, `get_goals`, `get_score`, `get_patterns`, `get_recommendations`, `add_event`.
- [ ] Voice mode: pick a calm, low voice in the Claude app voice settings. Volume up, silent mode off.
- [ ] The demo week is loaded (Today screen shows real blocks) and the score endpoint answers.
- [ ] In the Michael app, open `/chat`, hold the mic once and say "test" so the browser has asked
      for the microphone already. Never let the permission prompt appear on stage.
- [ ] Open the app in Safari, not from the home screen icon: iOS home screen apps cannot use
      in-app speech recognition, and the mic then only points to keyboard dictation.
- [ ] Do Not Disturb on, except the Apple Watch nudge we want to show.

## Script A: Claude voice mode (90 seconds)

Open the Claude app, start a new chat, tap the voice button. Speak naturally; pause after each line.

| You say                                                     | What should happen                                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| "Hey Claude, ask Michael how my day is going."              | Claude calls `get_score` and `get_timeline`, answers with the share of goal time and one fact. |
| "Where did I lose time today?"                              | `get_patterns`: names the biggest leak with minutes, for example scrolling after lunch.        |
| "Am I on track for the gym this week?"                      | `get_goals` plus the score: "2 of 3 sessions, 1h 40m of 3h."                                   |
| "Block an hour for the gym tomorrow evening, before eight." | `add_event` creates a gym block on the user's own calendar. Claude reads back the time.        |
| (Turn to the audience) "And it is already on my timeline."  | Show the Timeline screen in the Michael app with the new block.                                |

Say it in your own words; Claude chooses the tools. If Claude asks which Michael tool to use, say
"use Michael" once. If a tool call needs approval, tap Allow: that is the one tap approval we pitch.

**Line to land:** "Any AI I already use can read my day and act on it, within what I allowed. And
every query is logged, so Michael tells me who asked about me today."

## Script B: push to talk in the Michael app (45 seconds)

Open the Michael app on the phone, Chat tab.

1. Hold the mic button. The ring pulses while Michael listens; your words appear above the box.
2. Say: "How much deep work have I done today?" Let go.
3. Michael answers in text and speaks it in a calm, low British voice.
4. Hold again: "When should I train tomorrow?" Let go. He gives a time tied to the gym goal.

The voice is ElevenLabs (free tier) when the team has set `ELEVENLABS_API_KEY` on the API,
otherwise the best low en-GB voice the phone has. Both sound fine; ElevenLabs sounds better in a hall.

## If something goes wrong

| Problem                                | Recovery                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude does not call Michael           | Say "use the Michael connector". Check the connector is switched on in the chat's tools menu.                                                                 |
| Connector asks to sign in again        | Tap through the consent page; it takes one tap.                                                                                                               |
| Mic button says voice is not supported | Use Safari on iPhone or Chrome on Android or desktop. Firefox has no speech recognition.                                                                      |
| "Tap the mic on your keyboard"         | The app is opened from the iPhone home screen, where iOS refuses in-app recognition. Open it in Safari for hold to talk, or tap the keyboard mic and dictate. |
| Michael speaks only on the second try  | iOS unlocks sound on the release of a tap. Hold and let go once before the pitch.                                                                             |
| No sound from Michael                  | Silent switch off, volume up. The reply is always on screen, so read it out and carry on.                                                                     |
| Chat says it cannot talk yet           | `ANTHROPIC_API_KEY` is missing on Railway. Switch to Script A.                                                                                                |

## Privacy line (if asked)

Speech recognition runs in the browser; Michael only ever receives the text. No audio is recorded or
stored by us: the voice out is generated from Michael's reply text (never the user's voice) and
played once in the browser.
