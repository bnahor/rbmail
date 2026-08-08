# rb/mail

One calm inbox for every account.

rb/mail is an open-source, conversation-first mail client that brings Gmail and
Microsoft 365/Outlook accounts into one timeline. It keeps provider identity
visible, synchronizes incrementally, and is designed around intent search rather
than folder archaeology.

## Current state

The repository contains:

- a responsive Next.js mail client with desktop and mobile interaction patterns;
- encrypted local SQLite storage;
- multi-user Better Auth sessions with tenant-isolated mail and calendars;
- Composio-managed Gmail and Outlook connections, credential refresh, and
  authenticated provider requests;
- Gmail History and Microsoft Graph delta synchronization;
- a provider-neutral normalized mail model;
- a unified Today agenda across writable Google and Outlook calendars;
- Calendar-backed Google Meet and Microsoft Teams event creation;
- encrypted event storage with Google sync tokens and Microsoft delta links;
- a native macOS desktop wrapper and repeatable signing/notarization script.

The UI automatically switches from realistic demo conversations to connected
mail as soon as an account is added.

## Local setup

Requirements: Node.js 22.22.3+, pnpm 10+, and a Composio project API key for
managed Gmail and Outlook connections. Direct provider OAuth credentials remain
an optional rollback path.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000/settings`, connect an account, and keep the local
server running while OAuth completes.

Rubidium uses Better Auth for product identity and sessions. Users can create an
email/password account, then connect one or more Gmail or Outlook accounts using
Composio Connect Links. Composio holds and refreshes provider credentials;
Rubidium stores only the opaque connected-account ID and its encrypted local
mail/calendar cache. Optional Google and Microsoft social sign-in can remain
enabled independently. Set `BETTER_AUTH_SECRET` to at least 32 high-entropy
characters in production.
`RBMAIL_ACCESS_PASSWORD` is only a one-time migration code for mail synced by
the older single-owner release.

### Composio managed connections

Create a current Composio project key (`ak_…`) with read/write access to auth
configs, connected accounts, toolkits, sessions, and proxy execute. Then set:

```bash
COMPOSIO_ENABLED=true
COMPOSIO_API_KEY=ak_your_project_key
```

Rubidium uses the stable Better Auth user ID as Composio's user ID, enables
multiple private connections per toolkit, and explicitly selects the opaque
connected-account ID for every provider request. The Connect Link returns to
`${APP_URL}/api/composio/callback`.

### OAuth callbacks

- Google sign-in: `http://localhost:3000/api/auth/callback/google`
- Google additional mailbox: `http://localhost:3000/api/oauth/google/callback`
- Microsoft sign-in: `http://localhost:3000/api/auth/callback/microsoft`
- Microsoft additional mailbox: `http://localhost:3000/api/oauth/microsoft/callback`

Google requires the Gmail and Google Calendar APIs with delegated
`gmail.modify`, `gmail.send`, `calendar.events`, and
`calendar.calendarlist.readonly` scopes. Microsoft requires delegated
`Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`,
`Calendars.ReadWrite.Shared`, `User.Read`, and `offline_access` permissions.
Existing connections must reconnect once when calendar scopes are first added.
Meet and Teams links are created through provider calendar events, so standalone
meeting API permissions are not requested.

When a Google OAuth project is in testing mode, add each pilot address under
Google Auth Platform → Audience → Test users. Testing-mode grants that include
these scopes expire after seven days.

## macOS app

Build a local desktop app pointed at the development server:

```bash
pnpm desktop:build
pnpm desktop:open
```

To build for a hosted deployment, set `RBMAIL_APP_URL=https://your-domain`.
The build is ad-hoc signed when no Apple identity is available. For a public
release, set `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID`, and
`APPLE_APP_PASSWORD`, then run with `RBMAIL_NOTARIZE=1`. The script signs with
the hardened runtime, submits to Apple, staples the ticket, and verifies the app.

## Privacy model

Mail and calendar content is encrypted before SQLite persistence with
AES-256-GCM. For Composio-backed accounts, provider access and refresh tokens do
not enter Rubidium; Composio stores and refreshes them. Direct-fallback account
tokens remain encrypted locally. A local install creates `data/master.key` with
owner-only permissions. Hosted deployments must set a stable
`RBMAIL_MASTER_KEY` and mount `RBMAIL_DATA_DIR` on durable storage.

This is encryption at rest, not end-to-end encryption: a running rb/mail server
can decrypt data for its authenticated client. Remote images are blocked by
default in the UI.

## Deployment

The Dockerfile runs the web app and SQLite database as one service. On Railway,
mount a persistent volume at `/data`, set `RBMAIL_DATA_DIR=/data`, configure the
Composio values from `.env.example`, set `APP_URL` to the public HTTPS domain,
and set a stable `BETTER_AUTH_SECRET`.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm build
```

## License

MIT
