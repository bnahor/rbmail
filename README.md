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
- Gmail OAuth and Gmail History synchronization;
- Microsoft identity OAuth and Graph delta synchronization;
- a provider-neutral normalized mail model;
- a native macOS desktop wrapper and repeatable signing/notarization script.

The UI automatically switches from realistic demo conversations to connected
mail as soon as an account is added.

## Local setup

Requirements: Node.js 22.13+, pnpm 10+, and OAuth web-app credentials for the
providers you want to connect.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000/settings`, connect an account, and keep the local
server running while OAuth completes.

### OAuth callbacks

- Google: `http://localhost:3000/api/oauth/google/callback`
- Microsoft: `http://localhost:3000/api/oauth/microsoft/callback`

Google requires the Gmail API and delegated `gmail.modify` and `gmail.send`
scopes. Microsoft requires delegated `Mail.ReadWrite`, `Mail.Send`, `User.Read`,
and `offline_access` permissions.

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

Mail content, OAuth refresh tokens, and provider access tokens are encrypted
before SQLite persistence with AES-256-GCM. A local install creates
`data/master.key` with owner-only permissions. Hosted deployments must set a
stable `RBMAIL_MASTER_KEY` and mount `RBMAIL_DATA_DIR` on durable storage.

This is encryption at rest, not end-to-end encryption: a running rb/mail server
can decrypt data for its authenticated client. Remote images are blocked by
default in the UI.

## Deployment

The Dockerfile runs the web app and SQLite database as one service. On Railway,
mount a persistent volume at `/data`, set `RBMAIL_DATA_DIR=/data`, configure the
OAuth values from `.env.example`, and set `APP_URL` to the public HTTPS domain.

## License

MIT
