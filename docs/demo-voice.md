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
- [ ] On iPhone (Safari or the home screen app) the mic records and the API transcribes with
      ElevenLabs Speech to Text (setup manual step 10). No live words while you speak: the line
      appears once you let go, about a second later. Without that permission on the key, open the
      app in Safari (browser recognition) rather than from the home screen icon.
- [ ] Focus and Do Not Disturb off on the stage iPhone and watch (the watch buzz needs them off;
      silence the laptop instead). The pitch script is `docs/pitch.md`; this page is the detail.

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

## Script C: talk to Michael hands free (60 seconds)

Chat tab, tap the wave button left of the Mi button once. The sheet opens and Michael listens.

1. Say: "How much deep work have I done today?" and pause. After about a second he answers in one
   or two sentences, by voice, with the words on screen, and listens again.
2. Say: "Block an hour for it this afternoon." He books it and says the undo time.
3. While he speaks, tap the Mi symbol (or, on a laptop, just talk): he stops and listens.
4. Tap End, or stay quiet for nine seconds and he ends it himself. The lines stay in the chat.

On iPhone, speaking over him is off (the microphone would cut his voice); a tap cuts in.

## If something goes wrong

| Problem                                | Recovery                                                                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude does not call Michael           | Say "use the Michael connector". Check the connector is switched on in the chat's tools menu.                                                                                             |
| Connector asks to sign in again        | Tap through the consent page; it takes one tap.                                                                                                                                           |
| Mic button says voice is not supported | Use Safari on iPhone or Chrome on Android or desktop. Firefox has no speech recognition.                                                                                                  |
| "Tap the mic on your keyboard"         | Neither the browser nor the API can listen here (the ElevenLabs key lacks Speech to Text, setup manual step 10). Open it in Safari for hold to talk, or tap the keyboard mic and dictate. |
| Michael speaks only on the second try  | iOS unlocks sound on the release of a tap. Hold and let go once before the pitch.                                                                                                         |
| No sound from Michael                  | Silent switch off, volume up. The reply is always on screen, so read it out and carry on.                                                                                                 |
| Chat says it cannot talk yet           | `ANTHROPIC_API_KEY` is missing on Railway. Switch to Script A.                                                                                                                            |

## Privacy line (if asked)

Where the browser can, speech recognition runs in the browser and Michael only receives the text.
On iPhone the sentence is recorded, sent once to be transcribed (ElevenLabs Speech to Text) and
dropped: the audio is never stored or logged by us, only the words are kept, as in typed chat. The
voice out is generated from Michael's reply text (never the user's voice) and played once.

## Yo Michael: say his name, or hold the Mi button

Two ways in, both from any screen, the island at the top answers (the screen stays as it is):

- **Say his name.** The first time Chat opens (or on Today after a day, if Chat was never opened)
  Michael offers it once: "Want to just say my name to talk to me?" with Turn on and Not now. Turn
  on is the tap that allows the microphone and, on iPhone, his voice. It is also the switch **Yo
  Michael** on You. While on and the app is open, the Mi button wears a still ring. Say "Michael",
  "hey Michael" or "yo Michael": a chime and a tick, and he listens. "Michael, how is my day going"
  sends the request straight away.
- **Hold the Mi button** (top right; at the foot of the sidebar on a laptop), like the side button
  for Siri. Works everywhere the microphone does, the iPhone Home Screen app included (the turn is
  recorded and transcribed by the API there). Hold: the island opens listening; let go: he
  answers, and the answer stays six seconds. A short tap still opens You. After his first answer in
  Chat a one time hint under Mi says "Hold me to talk."

Where saying his name cannot work, the offer and the You row say why in one line instead of a
switch that does nothing: the Home Screen app "On iPhone, hold the Mi button to talk. Saying my name
needs Safari or Chrome."; no recogniser "This browser can't listen for my name. Hold the Mi button
to talk."; a blocked microphone says where to allow it for that browser.

**Debugging on a phone.** Open any screen with `?debug=voice` (it stays for the visit; `?debug=off`
hides it). While armed a small island says "Armed" and the session count; tap it for the last words
the recogniser heard, how the last session ended and the restart gap.

**How it works.** `apps/web/lib/wake-word.ts` matches the name at the start of a phrase on the
browser's own transcript (case and punctuation ignored; "Michaela", "Michael's" and a name in the
middle of a sentence do not count; "Micheal", "Michel", "Mikael" do). The loop in
`components/voice/wake-word-host.tsx` runs the Web Speech API recogniser (continuous, interim
results) and stops at once when the app is hidden, off the record, in a meeting, while push to
talk or a conversation holds the microphone, and while Michael speaks, so he never wakes himself.
Browsers end a session on their own (Safari every few seconds, Chrome after about a minute): the
next starts within 100ms (`components/voice/wake-loop.ts`), and a session that ends with the name
in an unfinished phrase still wakes him. Errors back off (1, 2, 4 ... 32 seconds); quick clean ends
restart at once four times before they back off; after six failures it rests until the app is
opened again. No second voice stack: the wake only starts `startConversation` in
`components/voice/conversation.ts`.

**Privacy.** Nothing reaches Michael's API until the name is heard; the match runs in the browser.
Where Chrome has an on device English pack (`SpeechRecognition.available` and `install` with
`processLocally`, Chrome 139 and later) the switch downloads it on the first tap and audio never
leaves the device; the line under the switch says "Heard on this device". Where only the browser's
cloud service exists, the line says so before it is switched on: "Your browser's speech service
hears what is said while I listen." If the pack cannot be had, or on device listening later stops
working, the switch turns off and says so rather than moving to the cloud by itself. `available()`
is only called inside the switch's tap: in headless Chromium it crashes the tab, so it is never
called on page load.

**Browser support** (checked against MDN and the spec, and in Chromium with a scripted recogniser
in `e2e/tests/wake-word.spec.ts`; not yet on real phones):

| Where                      | Wake word                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome, laptop and Android | Yes. On device with a language pack, else Google's speech service.                                                                    |
| Safari, iPhone and Mac     | Tries. `webkitSpeechRecognition` ends sessions often and the mic indicator may blink on each restart; Apple decides where audio goes. |
| iPhone Home Screen app     | Refused by iOS: the switch is off and says to hold the Mi button (which works there) or use Safari.                                   |
| Firefox                    | No recogniser: the switch is off and says to hold the Mi button.                                                                      |

Before trying it on stage: turn the switch on once by hand (that tap allows the microphone and, on
iPhone, his voice), then leave the phone unlocked with the app in front. A screen lock or another
app stops listening; coming back starts it again.

**From everywhere, later (not built).** The in app wake word only hears while Michael is open. The
routes to "Michael" from anywhere: a Siri Shortcut ("Hey Siri, ask Michael") that opens
`/chat?talk=1` or calls the API; the iPhone Action Button bound to that Shortcut; an Apple Watch
complication or Shortcut on the wrist; a Mac menu bar app with an on device wake word (Porcupine or
openWakeWord) that opens the conversation; and an Android assistant app action. Each one only
starts the same conversation.
