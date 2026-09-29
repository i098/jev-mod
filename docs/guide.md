# Jev-Mod setup and operations

[Project overview](../README.md) · [Hosted dashboard](https://jev-mod.jerry-2c0.workers.dev) · [Docker self-hosting](self-hosting.md)

## Stack

The website started from Better-T-Stack 3.44.2 with React, TanStack Router, Hono, Better Auth, Drizzle, and Cloudflare D1.
DaisyUI provides controls and component styles while preserving the original dashboard navigation.
Effect 3 handles typed Jev failures, interruptible request timeouts, and cleanup.
The Discord Gateway connection uses discord.js in one bot process, supervised by Cloudflare Containers or Docker Compose.

Both hosting options serve the built website and API on one origin.
Cloudflare uses a Worker, D1, and a Container with a private outbound store bridge.
Docker Compose uses a Node server, persistent SQLite, and a separate bot container; no Cloudflare account is needed.
Both use the same store operations, authentication, policies, and migrations.
Saved server TypeSafe keys stay encrypted in the database and are used only by the server.

The generator currently emits prerelease Alchemy 2 and Effect 4 infrastructure.
This project uses Wrangler for the Worker, D1, and Container definitions so application code remains on stable Effect 3 and Drizzle 0.45.
The generated stack metadata remains in `bts.jsonc`.

## Local preview

Use Node.js 26.7 or later and pnpm 10.33.2.

```sh
git clone https://github.com/undeemed/jev-mod.git
cd jev-mod
pnpm install --frozen-lockfile
pnpm dev:setup
pnpm dev
```

Open <http://localhost:3102>.
The API runs on port 7102.
`dev:setup` applies schema only to the local preview database.
The preview contains sample servers and cases, and stores configuration changes in local D1.
It does not connect to Discord or Jev, and it cannot delete Discord messages.
The message tester rejects tests with enabled Jev rules rather than returning simulated classifications.
To test blocked phrases and mention limits in preview, disable all Jev rules and save first.
API key controls and Discord actions are disabled in preview.
The preview entrypoint rejects non-loopback hosts and is separate from the production entrypoint.

For a parallel checkout, set an unused `WEB_PORT` and `API_PORT` pair and update the preview `PUBLIC_URL` to match.

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
An attachment-only edit that changes Discord's message revision triggers another text evaluation.
Automatic moderation excludes bot messages and direct messages.
Jev decisions delete messages after Discord displays them; they do not intercept the original send.

### Dashboard use

- **Auto moderation** edits the mode, Jev instructions, thresholds, and actions.
  Select **Save changes** before using **Test saved rules**; the tester ignores channel and role exceptions and never performs a Discord action.
- **Server settings** has tabs for exceptions, content filters, actions/logs, the API key, and history.
  Search exception options by name or ID; selected options remain available for removal when outside the search results.
  Add blocked phrases individually and use **Limit mentions** to enable or disable the mention threshold.
  Every **Delete + timeout** action uses the same timeout duration, editable beside timeout actions or in **Actions/logs**.
- **Activity** searches stored message text and filters by outcome, rule, channel, and date.
  Results scroll inside the case table; **Load older cases** continues the current search.
  Open a reviewable case to dismiss it or request message deletion.

Settings drafts survive navigation between views for the same server and Activity refreshes.
Help icons explain settings and data sharing on hover, keyboard focus, click, or tap; Escape dismisses the tooltip.
Select **Edit detection instructions** to open the editable text for a rule.
Leaving that server or signing out asks whether to discard unsaved settings.
API key changes use their own save and remove controls; successful changes clear the password field.
Cases migrated without a recorded Discord revision remain visible but cannot delete messages through case review.

### Enforcement limits

The bot checks message contents, exemptions, and current settings before deletion.
It checks policy again before a timeout and records partial failures separately.
Discord has no conditional delete endpoint, so an edit or permission change in the final network window cannot be made atomic with deletion.
Discord Gateway restarts can also leave gaps in message observation.
Do not treat the bot as a guarantee that every unwanted message is blocked.

## Hosting

For a normal VPS, follow [Docker Compose self-hosting](self-hosting.md).
The app still calls TypeSafe for classification; Jev does not run locally.
The Node entrypoint requires Node 26.7.0 or later, matching the root package engine requirement.
For a direct Node start after configuring `.env` and building the website, run `node --env-file=.env apps/server/src/node.ts`.
This uses `data/jev-mod.sqlite` by default, separate from the D1 preview; set `PORT` and `DATABASE_PATH` explicitly when running another local instance.

### Cloudflare setup

No production resources or Discord application are created by installing dependencies or running checks.
Use your own Cloudflare account and verify its ID with `pnpm exec wrangler whoami` before creating resources.
Confirm Container availability and pricing for your account.

1. Create a Discord application named **Jev-Mod** in the [Developer Portal](https://discord.com/developers/applications).
2. Enable public bot installation and the **Message Content Intent**.
3. Configure Guild Install with `bot` and `applications.commands` scopes.
4. Create a D1 database in the intended Cloudflare account, then replace the placeholder `database_id` in `wrangler.jsonc`.
5. Set `PUBLIC_URL` in `wrangler.jsonc` to the final HTTPS origin.
6. Add `${PUBLIC_URL}/api/auth/callback/discord` as the Discord OAuth redirect URL.
7. Supply the Worker secrets below through Wrangler or the Cloudflare dashboard; the TypeSafe fallback is optional.
8. Review and explicitly apply the D1 migrations to the new production database.
9. Deploy with `BOT_ENABLED` still set to `false`, verify login and the account selection, then enable the bot and deploy again.
10. Install Jev-Mod into a test server, verify monitoring, then opt into protection in the dashboard.

```sh
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put DISCORD_CLIENT_ID
pnpm exec wrangler secret put DISCORD_CLIENT_SECRET
pnpm exec wrangler secret put DISCORD_BOT_TOKEN
pnpm exec wrangler secret put KEY_ENCRYPTION_SECRET
# Optional operator fallback when a server has no saved key.
pnpm exec wrangler secret put TYPESAFE_API_KEY

# Explicit production schema action; inspect the account and SQL first.
pnpm exec wrangler d1 migrations apply DB --remote

pnpm deploy
```

Generate distinct `BETTER_AUTH_SECRET` and `KEY_ENCRYPTION_SECRET` values with separate `openssl rand -hex 32` calls.
`KEY_ENCRYPTION_SECRET` must contain exactly 64 hexadecimal characters.
Back up the encryption secret separately from the database; losing it makes saved server keys unusable.
Do not paste secrets into source files, issue bodies, or PR descriptions.
`.dev.vars.example` documents the names for local live-mode testing.

Discord requires View Channel, Read Message History, Manage Messages, Send Messages, and Moderate Members for the supported features.
The generated invite does not request Administrator permission.
Channel overrides can still prevent an action, and timeout requires a suitable bot role position.
Verified public bots must obtain any required privileged-intent approval from Discord.

## Runtime and data

The Container uses the stable name `gateway-v1` and runs a single Gateway client.
It remains active while enabled, and a one-minute scheduled check starts it again after interruption.
The bot's internal health endpoint reports Gateway readiness.
On Cloudflare, `/healthz` returns HTTP 200 with `bot: "connected"` only when the enabled bot is ready.
Unavailable or invalid bot health responses return HTTP 503 with `bot: "unavailable"`.
When `BOT_ENABLED` is not `true`, the endpoint returns HTTP 200 with `bot: "disabled"` without checking the bot.
Cloudflare health responses use `Cache-Control: no-store` and do not expose provider errors.
The portable Node `/healthz` checks HTTP liveness only and returns HTTP 200 with `status: "ok"`.
Compose uses that check before starting the separate bot, whose health check verifies Gateway readiness.
A watchdog exits after a prolonged disconnected state so supervision can restart the process.
Persistent settings and cases live in D1 on Cloudflare or in the Compose database volume.
Only the website server opens the SQLite database; bot requests use authenticated operation-based RPC.

The initial worker is a single Gateway shard with bounded moderation work.
Add explicit shard coordination before exceeding Discord's unsharded bot limits; do not increase `max_instances` and run duplicate clients.
The bot processes at most six messages concurrently and admits at most 60 submissions per server per minute.
Server-side classification shares limits of 60 evaluations per server per minute and 600 across the deployment between the bot and dashboard tester.
Overload and model failures leave messages unchanged.
The dashboard tester also limits each user to ten tests per minute when Jev rules are enabled.
For deterministic-only moderation, disable all Jev rules and save; phrase and mention checks then need no TypeSafe key or model request.
If any Jev rule remains enabled, a classification failure prevents automatic action even when a local filter matches.
Each server administrator can save, replace, or remove a TypeSafe key in **Server settings > API key**.
Automatic moderation and the tester use that server key, then the optional operator key if no server key exists.
The dashboard returns only key status, never saved plaintext.
When no key is available, model classification reports an actionable error and leaves messages unchanged.

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

See [local verification](verification.md) for automated coverage, the separate browser fixture, recorded results, and live acceptance limits.
`check` runs TypeScript checks, builds the website, and bundles the production Worker with a Wrangler dry run.
These checks do not prove live Discord OAuth, model accuracy, Container recovery, or Cloudflare deployment.
Local quality checks are configured for no-mistakes; no CI workflow is added.

## References

[OSS bot research](oss-moderation-research.md) compares YAGPDB, Red, Zeppelin, and Modmail.
No reference-project source was copied.
Zeppelin is source available under ELv2 and is used only as a behavior reference.

API behavior follows the [TypeSafe API](https://docs.typesafe.ai/api), [Discord Gateway](https://docs.discord.com/developers/events/gateway), [Better Auth Discord guide](https://better-auth.com/docs/authentication/discord), and [Cloudflare Container binding guide](https://developers.cloudflare.com/containers/configuration/workers-connections/).

## License

Jev-Mod is available under the [MIT license](../LICENSE).
Retained Better-T-Stack template notices appear in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
Dependency licenses remain with their respective packages.

## Support and contributions

[Report bugs or request features](https://github.com/undeemed/jev-mod/issues).
Include reproduction steps and your hosting option; keep API keys, OAuth tokens, and private Discord messages out of public reports.
For code changes, run `pnpm test` and `pnpm check` before opening a pull request.
