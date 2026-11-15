# Manual setup steps (the few things only a human can do)

Everything else is automated. Each step says who, how long, exactly where to click, and what to send
back. When a step is done, tick it on the Build Hub board; agents pick up the rest.

Live app: https://michael-zeta-sand.vercel.app · Supabase project: `kpcoadbgevifyvvlhdbt`

To put a value on Railway without pasting it into a chat (PowerShell, in the repo folder):

```powershell
$v = Read-Host "value"; railway variables --service api --set "NAME=$v"
```

---

## 1. Google sign in (Loukas, 10 min)

Google Cloud console has renamed menus over time; both names are given.

1. Open https://console.cloud.google.com, sign in with the Google account that should own Michael.
2. Top bar, project picker, **New project**. Name `Michael`, **Create**, then select it.
3. Left menu **APIs & Services > OAuth consent screen** (newer UI: **Google Auth Platform**).
   - **Get started**. App name `Michael`, support email: yours. **Next**.
   - Audience: **External**. **Next**. Contact email: yours. **Next**, agree, **Create**.
4. **Audience** tab (or **Test users** section): **Add users**: your Gmail and Manolis' Gmail. **Save**.
5. **Clients** tab (or **APIs & Services > Credentials > Create credentials > OAuth client ID**):
   - Application type **Web application**, name `Michael web`.
   - **Authorised JavaScript origins**: `https://michael-zeta-sand.vercel.app` and `http://localhost:3000`
   - **Authorised redirect URIs**: `https://kpcoadbgevifyvvlhdbt.supabase.co/auth/v1/callback`
   - **Create**. A dialog shows **Client ID** and **Client secret**: keep it open.
6. Open https://supabase.com/dashboard/project/kpcoadbgevifyvvlhdbt/auth/providers
   - Click **Google**, switch **Enable Sign in with Google** on.
   - Paste **Client ID** and **Client Secret**. **Save**.
7. Open https://supabase.com/dashboard/project/kpcoadbgevifyvvlhdbt/auth/url-configuration
   - **Site URL**: `https://michael-zeta-sand.vercel.app` , **Save**.
   - **Redirect URLs > Add URL**: `https://michael-zeta-sand.vercel.app/**` and `http://localhost:3000/**`.
8. Test: open the app in a private window, **Continue with Google**, choose your account. You land on
   Today, signed in to your own (empty) account.

Done when: you are signed in as yourself. Tick "google-oauth-client" on the board.

## 2. Your Claude connector (Loukas and Manolis, 2 min each, after step 1)

No key: Claude signs in to Michael like any built-in connector, and sees only your own data.

1. claude.ai (web or desktop): **Settings > Connectors > Add custom connector**.
2. Name `Michael`, URL `https://api-production-16521a26.up.railway.app/mcp` (nothing after `/mcp`).
   Leave the OAuth fields empty. **Add**, then **Connect**.
3. A Michael page opens: sign in with Google if asked, check what Claude may see, tap **Allow**.
4. New chat, tools menu, make sure **Michael** is on. Ask: "What are my goals and how did today go?"
5. Claude Code instead (terminal): `claude mcp add --transport http michael https://api-production-16521a26.up.railway.app/mcp`,
   then type `/mcp` inside Claude Code, pick `michael`, **Authenticate**, and Allow in the browser.
   If you added it earlier with the shared key, run `claude mcp remove michael` first: that one is the demo account.

The phone app and voice mode use the same connector automatically. Revoke it any time under Agents.

## 3. Google Calendar (Loukas, 3 min, same Google project as step 1)

1. https://console.cloud.google.com/apis/library/calendar-json.googleapis.com, project `Michael`,
   **Enable**.
2. **Google Auth Platform > Data access > Add or remove scopes**: tick
   `.../auth/calendar.readonly` and `.../auth/calendar.events`. **Update**, **Save**.
3. **Clients > Michael web > Authorised redirect URIs > Add URI**:
   `https://api-production-16521a26.up.railway.app/v1/oauth/google_calendar/callback`. **Save**.
4. Put the same client on Railway: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (snippet above).

Then each user taps **Connect Google Calendar** in the app once (issues #12, #13). A brand new
account does not even need that tap: right after **Continue with Google** on /login, the app goes
straight on to Google's calendar consent (#270). It is the same OAuth client and the same scopes as
above, so there is nothing new to set up in the console. If Google is not configured, onboarding
simply starts with the goals and a Connect pill.

## 4. Maps and traffic (Loukas, 5 min; #115 is built, travel is skipped until the key is set)

1. https://console.cloud.google.com/billing: link a billing account to project `Michael`
   (the free monthly usage covers the demo: 5,000 traffic aware routes and 10,000 geocodes).
2. Enable both APIs:
   https://console.cloud.google.com/apis/library/routes.googleapis.com **Enable**, and
   https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com **Enable**.
3. **APIs & Services > Credentials > Create credentials > API key**. Then **Edit API key >
   API restrictions > Restrict key > Routes API + Geocoding API**. Application restrictions:
   none (Railway has no fixed IP). **Save**.
4. Caps so a bug can never bill much: **Google Maps Platform > Quotas**, pick **Routes API**,
   set `ComputeRoutes requests per day` to 150; pick **Geocoding API**, set requests per day
   to 300. Billing > Budgets & alerts: a 10 EUR budget with an email alert.
5. Railway: `GOOGLE_MAPS_API_KEY`.

## 5. Telegram bot (Loukas, 3 min)

1. In Telegram search `@BotFather` (blue tick), **Start**.
2. Send `/newbot`. Name: `Michael`. Username: something free ending in `bot`, e.g. `michael_coach_bot`.
3. BotFather replies with a token like `123456:ABC...`. Railway: `TELEGRAM_BOT_TOKEN`.
4. Railway: `TELEGRAM_BOT_USERNAME` = the username without `@` (optional; the API asks Telegram).
   Redeploy; the API sets the webhook itself. Then **You > Nudges > Connect Telegram**, tap
   **Start**. Details: `docs/sources/telegram.md`.

## 6. Watch buzz on stage (whoever wears the watch, 1 min)

1. On the iPhone paired with the watch, App Store: install **ntfy** (free).
2. When #44 ships, the app shows a **Subscribe** button with your private topic; tap it once.
3. iPhone **Settings > Notifications > ntfy**: allow, **Time Sensitive** on. Watch app: mirror on.

## 7. Apple Watch data: prove it, then switch it on (Manolis, 5 min, on the stage iPhone)

Apple Watch shows Coming soon until a real event reaches production (#295). To prove it without
switching it on for everyone:

1. On the iPhone, signed in to Michael with Google, open
   `https://michael-zeta-sand.vercel.app/you/connections/apple-watch?preview=1` (only this link shows the steps; on a
   laptop it shows a QR code, and the QR keeps the preview).
2. **Open the App Store**, install **Health Auto Export - JSON+CSV** (free for 7 days, then Premium).
3. Tap **Add sleep and heart rate**: the app opens with the automation filled in. **Save**,
   allow Health access, then in the automation tap **Export Now**. Back in Michael, **Add workouts**.
4. Stay on the Michael page: it says "Connected. Last data just now." within a minute or two, or
   names the step to recheck.
5. Once it says Connected: change `"apple-watch": "soon"` to `"live"` in
   `packages/shared/src/connectors.ts` with the proof in the comment, and note it on the Build Hub.

## 8. Your Mac (Manolis and Loukas, 2 min)

In Michael: **You > Connections > Mac > Connect > Copy**, then paste the line into Terminal in
the repo folder (see `apps/collector` README). Real data then goes to your own account.

## 9. Team access (Loukas, 2 min)

- Supabase: https://supabase.com/dashboard/org/fxrcbmgqabpcwttidoxw/team > **Invite** > Manolis' email.
- Railway: project `michael` > **Settings > Members** (needs the Pro plan; deploys don't need it).

## 10. Voice input on iPhone (Loukas, 1 min)

The app transcribes speech with ElevenLabs Speech to Text when the browser cannot (the iPhone home
screen app). Same key as the voice, no new secret.

- https://elevenlabs.io/app/settings/api-keys > key **michael** > **Edit** > Access: turn on
  **Speech to Text** (keep Text to Speech on) > **Save**.
- Check: `GET /v1/voice` on the API answers `"transcribe": true`. If it says `false` within ten
  minutes of a try, the key still lacks the permission.
