# Docker Compose self-hosting

Run Jev-Mod on a VPS with Docker Engine, the Docker Compose plugin, and a public HTTPS reverse proxy.
No Cloudflare account is needed.
The website/API and bot run separately; only the server opens the persistent SQLite database.
The app calls the TypeSafe API for Jev classification; it does not run the model locally.
The images pin Node 26.7.0 and pnpm 10.33.2.

## Configure

1. Create a Discord application and enable public bot installation and Message Content Intent.
2. Set the Discord OAuth callback to `https://your-host/api/auth/callback/discord`.
3. Copy `.env.example` to `.env` and set `PUBLIC_URL` to your HTTPS origin without a trailing slash.
4. Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and `DISCORD_BOT_TOKEN` from your application.
5. Generate three separate secrets with `openssl rand -hex 32` for `BETTER_AUTH_SECRET`, `INTERNAL_RPC_SECRET`, and `KEY_ENCRYPTION_SECRET`.
6. Keep `BOT_ENABLED=false` for initial website setup.
7. Optionally supply `TYPESAFE_API_KEY` as an operator fallback; server administrators can instead save their own key in Settings.

```sh
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

Run the generator separately for each secret and paste each result into its own setting.
Never reuse a secret, commit `.env`, or include secrets in logs or issue reports.
`KEY_ENCRYPTION_SECRET` must be exactly 64 hexadecimal characters.
Keep a secure backup of it: existing server keys cannot be decrypted after its loss or replacement.
Changing `BETTER_AUTH_SECRET` also affects encrypted OAuth tokens and existing sessions.
Coordinate secret changes as maintenance; do not rotate them by editing one container alone.

## Start

```sh
docker compose up --build -d server
docker compose ps
curl --fail http://127.0.0.1:7102/healthz
```

The server automatically applies pending files from `packages/db/migrations` before serving requests.
Migration history records file checksums and rejects altered or missing applied migrations.
A migration failure prevents startup and rolls back pending schema changes.
No external database migration is run.
Startup also cleans expired cases and sessions; backup existing data before upgrades.

Route your public HTTPS host to `127.0.0.1:7102` with your reverse proxy.
For example, a host-installed Caddy site can use:

```caddyfile
moderation.example.com {
    @private path /internal/*
    respond @private 404
    reverse_proxy 127.0.0.1:7102
}
```

The app serves the React files and `/api` from the same origin.
Use the exact public HTTPS origin for `PUBLIC_URL` and the Discord callback.
HTTP is accepted only for a loopback development origin.
Set `HTTP_PORT` if host port 7102 is already in use, and use that port in your proxy.

The Node server derives rate-limit identity from the socket, not client-supplied forwarding headers.
Behind a reverse proxy, clients share the proxy's bucket; add per-client limits at your trusted edge if needed.
Forwarded IP headers cannot bypass the Node limit.

Sign in and verify the website first.
To enable moderation, set `BOT_ENABLED=true` and then start both services:

```sh
docker compose --profile bot up --build -d
```

Install the bot into a test server, confirm monitoring, and then choose protection in the dashboard.
The bot profile makes Discord startup explicit; do not start it with sample or invalid credentials.
New guilds start in monitoring mode.
`/jevmod status` and `/jevmod pause` remain available to members with Manage Server permission.

## Network and process limits

Only the server port is published, bound to host loopback.
The bot RPC port is not published.
Both RPC directions require the same random `INTERNAL_RPC_SECRET`, use bounded requests, and reject redirects.
The normal Compose bridge permits outbound HTTPS to Discord and TypeSafe.
Do not replace it with an internet-isolated network unless you also provide an outbound network.

Keep one server process and one bot process.
SQLite uses one connection with foreign keys, WAL, a finite busy timeout, and synchronous atomic batches.
Do not scale these services horizontally or run a second Gateway client for the same deployment.
`restart: unless-stopped` restarts exited processes; the bot watchdog exits after prolonged Gateway failure.
Container health checks expose readiness, but Docker does not restart a container solely because it becomes unhealthy.
Investigate persistent unhealthy status and inspect redacted service logs.

```sh
docker compose --profile bot ps
docker compose --profile bot logs --tail=100 server bot
```

## Persistence and backups

The named `database` volume contains `/app/data/jev-mod.sqlite` and its WAL files.
The image creates `/app/data` owned by the non-root `node` user (UID 1000).
Docker preserves that ownership when populating a new named volume.
If you replace it with a bind mount, give UID 1000 write access to that directory first.
Never use `docker compose down --volumes` unless you intend to delete all persisted data.

For a consistent file backup, stop both services and copy the entire database directory.
Do not copy only the main SQLite file while writes are active.

```sh
docker compose --profile bot stop bot server
mkdir -p backups/current
docker compose cp server:/app/data/. backups/current/
docker compose --profile bot start server bot
```

Store backups encrypted and outside the VPS; they contain moderation messages, OAuth state, and encrypted provider keys.
Back up the required secrets separately in an encrypted secret store.
A database backup without the matching encryption secret cannot restore saved TypeSafe keys.
Test restoration into a separate deployment before relying on a backup.

For restoration, stop both services, preserve the current volume for rollback, and copy the backup into a new empty volume at `/app/data`.
Use the matching application version and secrets.
Ensure the restored files are owned by UID 1000 before starting the server.
Do not overwrite an active database or restore onto mismatched WAL files.

## Upgrade

1. Read release notes and pending SQL migration files.
2. Stop services and take a consistent backup, including a separate secure copy of secrets.
3. Check out the intended version and run `docker compose --profile bot up --build -d`.
4. Check server and bot health, sign in, and verify settings and case history.

Do not start an older application against a newer schema.
For rollback, restore the matching pre-upgrade database backup and application image together.
Schema migrations are shared with D1, but the local journal and execution remain private to this volume.
Never point local verification at an existing operator database.

## Local checks

The focused Node test uses a disposable database and loopback HTTP with synthetic secrets.
It does not contact Discord or TypeSafe.

```sh
pnpm exec tsx --test test/node.test.ts
```

Implementation references: [Hono Node](https://hono.dev/docs/getting-started/nodejs), [Drizzle proxy](https://orm.drizzle.team/docs/connect-drizzle-proxy), [Node SQLite](https://nodejs.org/download/release/v26.7.0/docs/api/sqlite.html), and [Compose networking](https://docs.docker.com/compose/how-tos/networking/).
