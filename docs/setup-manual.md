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

1. In the app: **You > Connect Claude and your devices > Claude > Create my link > Copy link**.
2. claude.ai (web or desktop): **Settings > Connectors > Add custom connector**.
   Name `Michael`, URL: paste. **Add**. Leave OAuth fields empty.
3. New chat, tools menu, make sure **Michael** is on. Ask: "What are my goals and how did today go?"
4. Claude Code instead (terminal): `claude mcp add --transport http michael <the link>`.

The phone app and voice mode use the same connector automatically.

## 3. Google Calendar (Loukas, 3 min, same Google project as step 1)

1. https://console.cloud.google.com/apis/library/calendar-json.googleapis.com, project `Michael`,
   **Enable**.
2. **Google Auth Platform > Data access > Add or remove scopes**: tick
   `.../auth/calendar.readonly` and `.../auth/calendar.events`. **Update**, **Save**.
3. **Clients > Michael web > Authorised redirect URIs > Add URI**:
   `https://api-production-16521a26.up.railway.app/v1/oauth/google_calendar/callback`. **Save**.
4. Put the same client on Railway: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (snippet above).

Then each user taps **Connect Google Calendar** in the app once (issues #12, #13).

## 4. Maps and traffic (Loukas, 5 min, optional until #115 is built)

1. https://console.cloud.google.com/billing: link a billing account to project `Michael`
   (the free monthly usage covers the demo).
2. https://console.cloud.google.com/apis/library/routes.googleapis.com: **Enable**.
3. **APIs & Services > Credentials > Create credentials > API key**. Then **Edit API key >
   API restrictions > Restrict key > Routes API**. **Save**.
4. Railway: `GOOGLE_MAPS_API_KEY`.

## 5. Telegram bot (Loukas, 3 min)

1. In Telegram search `@BotFather` (blue tick), **Start**.
2. Send `/newbot`. Name: `Michael`. Username: something free ending in `bot`, e.g. `michael_coach_bot`.
3. BotFather replies with a token like `123456:ABC...`. Railway: `TELEGRAM_BOT_TOKEN`.
4. Send the bot username to the team (it goes in the Connections screen, #120).

## 6. Watch buzz on stage (whoever wears the watch, 1 min)

1. On the iPhone paired with the watch, App Store: install **ntfy** (free).
2. When #44 ships, the app shows a **Subscribe** button with your private topic; tap it once.
3. iPhone **Settings > Notifications > ntfy**: allow, **Time Sensitive** on. Watch app: mirror on.

## 7. Apple Watch data (Manolis, 5 min, after #8 ships)

1. App Store: **Health Auto Export - JSON+CSV** (paid, has a trial). Allow Health access.
2. In Michael: **You > Connect > Apple Watch > Create my link** (or use a personal token).
3. Health Auto Export: **Automations > New > REST API**. URL: the link from step 2. Format JSON.
   Metrics: sleep analysis, workouts, heart rate, HRV, steps. Interval: 5 minutes. **Save**.

## 8. Your Mac (Manolis and Loukas, 2 min)

In Michael: **You > Connect > Your Mac > Create my link > Copy**, then paste it into the collector
when it asks for the key (see `apps/collector` README). Real data then goes to your own account.

## 9. Team access (Loukas, 2 min)

- Supabase: https://supabase.com/dashboard/org/fxrcbmgqabpcwttidoxw/team > **Invite** > Manolis' email.
- Railway: project `michael` > **Settings > Members** (needs the Pro plan; deploys don't need it).
