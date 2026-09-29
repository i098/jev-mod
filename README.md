# Jev-Mod

A public-install Discord moderation bot with a configuration dashboard and TypeSafe Jev text classification.
Each server has separate rules, exceptions, settings, and moderation cases.

## Stack

The website started from Better-T-Stack 3.44.2 with React, TanStack Router, Hono, Better Auth, Drizzle, and Cloudflare D1.
DaisyUI provides controls and component styles while preserving the original dashboard navigation.
Effect 3 handles typed Jev failures, interruptible request timeouts, and cleanup.
The Discord Gateway connection uses discord.js in one Cloudflare Container.

The production Worker serves both the built website and API on one origin.
The container accesses D1 through a private Cloudflare outbound handler.
There is no public database bridge, separate MySQL host, or browser-side API key.

The generator currently emits prerelease Alchemy 2 and Effect 4 infrastructure.
This project uses Wrangler for the Worker, D1, and Container definitions so application code remains on stable Effect 3 and Drizzle 0.45.
The generated stack metadata remains in `bts.jsonc`.

## Local preview

Use Node.js 26.7 or later and pnpm 10.33.2.

```sh
pnpm install --frozen-lockfile
pnpm dev:setup
pnpm dev
```

Open <http://localhost:3102>.
The API runs on port 7102.
`dev:setup` applies schema only to the local preview database.
The preview contains sample servers and cases, and stores configuration changes in local D1.
It does not connect to Discord or Jev, and it cannot delete Discord messages.
The message tester reports that no live model is connected rather than returning simulated classifications.
The preview entrypoint rejects non-loopback hosts and is separate from the production entrypoint.

For a parallel checkout, set an unused `WEB_PORT` and `API_PORT` pair and update the preview `PUBLIC_URL` to match.
Ports 3102 and 7102 belong to this checkout; ports 3000 and 7030 are reserved elsewhere.

## Moderation

- Six editable Jev rules: scams, spam, hate speech, harassment, violent threats, and explicit sexual text.
- Per-rule threshold and action: log, delete, or delete plus timeout.
- Blocked phrases, mention limits, channel exceptions, role exceptions, and a moderator log channel.
- Monitoring, protection, and paused modes; new servers start in monitoring mode.
- New messages and edits, with duplicate-case protection and fresh checks before enforcement.
- Case history, manual dismissal, manual deletion, and settings audit records.
- `/jevmod status` and `/jevmod pause` for members with Manage Server permission.

Jev only evaluates text.
Image and attachment contents are not scanned.
Automatic moderation excludes bot messages and direct messages.
Jev decisions delete messages after Discord displays them; they do not intercept the original send.

The bot checks message contents, exemptions, and current settings before deletion.
It checks policy again before a timeout and records partial failures separately.
Discord has no conditional delete endpoint, so an edit or permission change in the final network window cannot be made atomic with deletion.
Discord Gateway restarts can also leave gaps in message observation.
Do not treat the bot as a guarantee that every unwanted message is blocked.

## Production setup

No production resources or Discord application are created by installing dependencies or running checks.
The deployment target is the user's 42nights Cloudflare account.
Verify the account ID with `pnpm exec wrangler whoami` before creating resources.
Credit coverage for Containers has not been verified; account credits are not automatically evidence of service eligibility.

1. Create a Discord application named **Jev-Mod** in the [Developer Portal](https://discord.com/developers/applications).
2. Enable public bot installation and the **Message Content Intent**.
3. Configure Guild Install with `bot` and `applications.commands` scopes.
4. Create a D1 database in the intended Cloudflare account, then replace the placeholder `database_id` in `wrangler.jsonc`.
5. Set `PUBLIC_URL` in `wrangler.jsonc` to the final HTTPS origin.
6. Add `${PUBLIC_URL}/api/auth/callback/discord` as the Discord OAuth redirect URL.
7. Supply the five Worker secrets below through Wrangler or the Cloudflare dashboard.
8. Review and explicitly apply the D1 migrations to the new production database.
9. Deploy with `BOT_ENABLED` still set to `false`, verify login and the account selection, then enable the bot and deploy again.
10. Install Jev-Mod into a test server, verify monitoring, then opt into protection in the dashboard.

```sh
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put DISCORD_CLIENT_ID
pnpm exec wrangler secret put DISCORD_CLIENT_SECRET
pnpm exec wrangler secret put DISCORD_BOT_TOKEN
pnpm exec wrangler secret put TYPESAFE_API_KEY

# Explicit production schema action; inspect the account and SQL first.
pnpm exec wrangler d1 migrations apply DB --remote

pnpm deploy
```

Generate `BETTER_AUTH_SECRET` with `openssl rand -hex 32`.
Do not paste secrets into source files, issue bodies, or PR descriptions.
`.dev.vars.example` documents the names for local live-mode testing.

Discord requires View Channel, Read Message History, Manage Messages, Send Messages, and Moderate Members for the supported features.
The generated invite does not request Administrator permission.
Channel overrides can still prevent an action, and timeout requires a suitable bot role position.
Verified public bots must obtain any required privileged-intent approval from Discord.

## Runtime and data

The Container uses the stable name `gateway-v1` and runs a single Gateway client.
It remains active while enabled, and a one-minute scheduled check starts it again after interruption.
The internal health endpoint reports Discord readiness, not just HTTP availability.
A watchdog exits after a prolonged disconnected state so supervision can restart the process.
Persistent settings and cases live in D1 rather than the container filesystem.

The initial worker is a single Gateway shard with bounded moderation work.
Add explicit shard coordination before exceeding Discord's unsharded bot limits; do not increase `max_instances` and run duplicate clients.
Jev work is capped at six concurrent calls in the bot, 60 queued submissions per server per minute, and 600 evaluations per minute across the account.
Overload and model failures leave messages unchanged.
The dashboard tester has a separate ten-request user budget within the same global evaluation budget.

Only flagged-message text is stored.
Cases and settings history expire after 30 days.
Removing the bot deletes that server's records; startup reconciles removals that occurred while the bot was offline.
OAuth tokens are encrypted by Better Auth, held server-side, and excluded from public auth endpoints.
Every server-specific dashboard request checks current Discord membership and permissions.

## Checks

```sh
pnpm test
pnpm check
```

Tests exercise real local D1 behavior through Miniflare, HTTP authorization, CSRF, compare-and-set writes, audit triggers, retention boundaries, duplicate case claims, and Discord action regressions with a mocked transport.
`check` runs TypeScript checks, builds the website, and bundles the production Worker with a Wrangler dry run.
These checks do not prove live Discord OAuth, model accuracy, Container recovery, or Cloudflare deployment.
Local quality checks are configured for no-mistakes; no CI workflow is added.

## References

[OSS bot research](docs/oss-moderation-research.md) compares YAGPDB, Red, Zeppelin, and Modmail.
No reference-project source was copied.
Zeppelin is source available under ELv2 and is used only as a behavior reference.

API behavior follows the [TypeSafe API](https://docs.typesafe.ai/api), [Discord Gateway](https://docs.discord.com/developers/events/gateway), [Better Auth Discord guide](https://better-auth.com/docs/authentication/discord), and [Cloudflare Container binding guide](https://developers.cloudflare.com/containers/configuration/workers-connections/).
