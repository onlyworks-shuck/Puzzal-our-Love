# Puzzle

A portfolio project that's outwardly a real-time, animated, installable 2048 puzzle game (`client/index.html`), built mobile-first for Android, with a single hidden real-time messaging channel tucked behind the game's Settings panel — no page reload, no visible hint that it exists. Frontend is HTML/CSS/vanilla JS; backend is Netlify Functions (Node.js) + Netlify Blobs, deployed on the same Netlify site as the frontend.

## Features

**Puzzle game (the landing experience)**
- 2048, rebuilt with a tile-identity animation engine (FLIP technique) so tiles genuinely slide and merge instead of just re-rendering
- Spawn pop, merge bounce, score-bump, and a confetti burst on winning
- Keyboard (arrow keys) and touch-swipe controls
- Mobile-first layout with a compact top bar (Reset, live score + best score, Settings) sized and spaced for Android screens, plus safe-area padding for notches
- A custom splash screen (using `icon.png`) on launch, and a real installable PWA — an "Install Puzzle Game" button triggers the native Android/Chrome install prompt and hides itself once installed
- Settings panel: Day/Night theme toggle, plus an "Enter" button that opens the secret channel directly

**Secret channel (100% hidden — reachable only via Settings → Enter)**
- No contacts, no search, no usernames — just one direct, global message thread. Everyone who has ever opened it shares the same conversation, near-real-time (~2.5s polling), on any device.
- Send photos and videos directly next to the text box (up to 5MB), alongside plain text.
- Delete your own messages for everyone — the content is actually erased from storage, not just hidden client-side, and replaced with a "This message was deleted" placeholder like WhatsApp.
- Enter to send, Shift+Enter for a new line, plus a small emoji picker.

No voice calling, no video calling, no contact list — by design.

## Tech stack

- **Frontend** (`/client`): plain HTML, CSS, JavaScript — no build step, no framework.
- **Backend** (`/client/netlify/functions`): Netlify Functions (Node.js), JWT auth, bcrypt, Netlify Blobs for storage (users, messages, uploaded media). Runs on the same Netlify site as the frontend — no separate server to host.
- The secret channel updates by polling (`GET /api/secret/messages` every ~2.5s while the chat is open, paused when the tab is hidden) rather than a persistent WebSocket, since serverless functions can't hold a long-lived connection open.

There's also a legacy `/server` folder (Express + Socket.IO) from an earlier version of this project. It's no longer used by the deployed site and isn't required — kept only in case you want to self-host instead of using Netlify Functions.

## Local development

```bash
cd client
npm install
npx netlify-cli dev --dir . --functions netlify/functions
```

Open the printed URL (`http://localhost:8888`). Note: Netlify Blobs' local emulation needs the project linked to a real Netlify site (`netlify link`) to work — otherwise function calls that touch storage will fail locally. Easiest path for local testing is still `netlify dev` after linking; otherwise just test against your deployed URL.

Tap the gear icon (Settings) → "Enter" to open the chat (no password prompt — see `client/js/game.js`); you're auto-signed in as a random guest behind the scenes. Open a second browser window (or incognito tab) and do the same — messages sent from either show up on both within ~2.5s, since everyone shares the same single conversation.

## Deploying

Everything lives on one Netlify site now — no second host needed.

1. **Link the project** (one-time): `netlify link` from the repo root, choosing your site.
2. **Set environment variables** on the Netlify site (Site settings → Environment variables), or via CLI:
   ```bash
   netlify env:set JWT_SECRET "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
   netlify env:set SECRET_CHAT_PASSWORD "your-guest-password-here"
   netlify env:set SECRET_CHAT_ADMIN_PASSWORD "your-admin-password-here"
   netlify env:set BLOBS_SITE_ID "<your site ID>"
   netlify env:set BLOBS_TOKEN "<a Netlify personal access token>"
   ```
   The `BLOBS_SITE_ID`/`BLOBS_TOKEN` pair works around a known Netlify platform bug where Blobs' automatic environment injection doesn't reliably reach functions in production (see `client/netlify/functions/_lib/store.js` for details/link). Without them you'll see `MissingBlobsEnvironmentError`.
3. **Deploy**:
   ```bash
   netlify deploy --prod --dir client --functions client/netlify/functions
   ```
   (The plain `--build`-based deploy currently mis-resolves the functions path when `base` is set in `netlify.toml`, so the explicit `--dir`/`--functions` flags are required.)

> The install prompt (`beforeinstallprompt`) and service worker only work over HTTPS or `localhost` — Netlify serves HTTPS automatically, so installability works out of the box once deployed.

## Project structure

```
client/                          deploy to Netlify (static site + functions)
  index.html                       the whole app — puzzle game on top, chat hidden underneath
  config.js                        API_BASE_URL (same-origin "/api", routed to functions via netlify.toml redirects)
  manifest.json                    PWA manifest (name, theme colors, icon)
  sw.js                            minimal service worker (app-shell caching, required for installability)
  icon.png                         app icon — used as the manifest/install icon and the splash logo
  css/style.css
  js/game.js                       2048 game engine + tile animations + Settings/"Enter" wiring
  js/pwa.js                        splash screen, service worker registration, install button
  js/api.js                        REST client + token storage
  js/secret.js                     the secret channel — guest session bootstrap, unlock flow, polling, rendering, media, delete
  js/emoji.js                      emoji picker data
  package.json                     dependencies for the Netlify Functions below
  netlify/functions/
    _lib/store.js                    Netlify Blobs-backed data layer (users, messages, unlocked state, media)
    _lib/auth.js                     JWT sign/verify helpers
    _lib/http.js                     small JSON response/body-parse helpers
    auth-register.js                 POST /api/auth/register
    users-me.js                      GET /api/users/me
    secret-unlock.js                 POST /api/secret/unlock
    secret-messages.js               GET /api/secret/messages (polled)
    secret-send.js                   POST /api/secret/send
    secret-delete.js                 POST /api/secret/delete
    secret-media-upload.js           POST /api/secret/media (5MB cap — see Security notes)
    secret-media-get.js              GET /api/secret/media-get?id=... (serves uploaded media)

server/                           legacy Express + Socket.IO backend, not used by the deployed site
netlify.toml                      base=client, functions dir, and the /api/* → /.netlify/functions/* redirects
```

## Security notes

- Guest accounts are still real accounts: a random username/password is generated client-side and registered through the normal `/api/auth/register` endpoint, so passwords are hashed with bcrypt like any other account.
- The secret channel now has two password tiers, both checked **only on the server** in `secret-unlock.js`:
  - `SECRET_CHAT_PASSWORD` unlocks the **guest** tier — full read/write access to the shared thread, but no delete capability at all (enforced server-side in `secret-delete.js`, not just hidden in the UI).
  - `SECRET_CHAT_ADMIN_PASSWORD` unlocks the **admin** tier — same shared thread, plus the ability to delete any message from either side, and the live camera monitor panel (see below).
  - Any other password returns the same generic 401 as a wrong guess and the client shows a decoy "developer dashboard" screen instead of a password-retry prompt, so a guessed entry never confirms a secret chat exists behind it.
  - The client never decides which tier a password belongs to — it calls `POST /api/secret/unlock` and the server marks that specific authenticated user's role in Blobs storage. Every other secret-channel endpoint independently re-checks that stored role.
- It's still two shared static passwords, not per-person accounts — anyone who learns the guest password has full read/write access to the one shared thread, and anyone who learns the admin password on top of that can also delete anything. Treat both like door locks, not encryption.
- All endpoints require a valid JWT (`Authorization: Bearer <token>`), checked independently of the unlock state.
- Set a strong, unique `JWT_SECRET` in production. Change both `SECRET_CHAT_PASSWORD` and `SECRET_CHAT_ADMIN_PASSWORD` from any defaults, and make sure they're different from each other.
- **Live camera sharing is opt-in only.** A user on either tier can tap a visible camera icon in the chat header to start broadcasting; a persistent red banner stays on screen the entire time a share is live, and tapping the icon again stops it instantly. The admin-tier monitor panel only ever shows whoever currently has that toggle switched on, and clears itself within a couple of seconds of them turning it off, closing the chat, or losing connection — there is no way to view a camera feed that its owner didn't explicitly start.
- `BLOBS_TOKEN` (see Deploying above) is currently a full Netlify personal access token, because Netlify doesn't offer a Blobs-scoped token today. That token grants broad account access, not just this one Blobs store — treat it as sensitive, and rotate it in Netlify's dashboard if you ever suspect it leaked. If Netlify's automatic Blobs context injection gets fixed (see the linked forum threads in `store.js`), these two env vars can be removed entirely.
- Photo/video uploads are capped at 5MB (down from 25MB in the old Express version) because Netlify Functions have a request-body size ceiling that a traditional server doesn't.
