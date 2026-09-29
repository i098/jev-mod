# Jev-Mod

## Objective

Build a public Discord moderation bot and web dashboard that any server administrator can install.
Use TypeSafe Jev to evaluate unwanted text and familiar moderation controls from YAGPDB and Red.
The implementation is original; no reference-project code is copied.
See [the source research](oss-moderation-research.md).

## Product behavior

Current administrator workflows, message handling, and enforcement limits are documented in [README](../README.md#moderation).

- Discord login lists servers that the user can manage and provides an installation link.
- Each server has separate rules, role and channel exceptions, cases, and settings.
- Jev checks spam, scams, hate speech, harassment, threats, and sexual content, with editable instructions and thresholds.
- Rules can log, delete, or delete and timeout a member.
- Simple local rules check blocked phrases and excessive mentions.
- New servers start in monitoring mode; an administrator enables enforcement in the dashboard.
- The dashboard offers rules, a message tester, activity, case review, and server settings.
- Settings use accessible tabs, searchable bounded exception selectors, phrase controls, and a shared timeout duration beside timeout actions.
- Activity has server-side search and filters, cursor pagination, and a bounded scrolling case table.
- Each server administrator can save, replace, or remove an encrypted TypeSafe API key.
- Cases show the rule, model, probability, requested action, and actual outcome.
- Unknown, failed, overloaded, or stale decisions never trigger an automatic punishment.
- Jev evaluates text only; image and attachment contents are outside this version.
- Jev decisions remove messages after posting, not before Discord displays them.

## Implementation

Use the approved Better-T-Stack selection: React, TanStack Router, DaisyUI, Hono, Better Auth, and Drizzle.
Use stable Effect 3 for typed model errors, request timeouts, and cleanup.
Serve the built dashboard and API from the same origin on both supported hosts.
On Cloudflare, use a Worker, D1, and a discord.js Container with a private outbound handler for store operations.
Verify the operator's Cloudflare account and Container eligibility before deployment.
On a normal VPS, use Docker Compose with a Node server, persistent SQLite, and a separate bot container.
Keep one shared store over Drizzle's D1 and SQLite proxy adapters and one set of ordered SQL migrations.
Authenticate both Compose RPC directions with a shared secret; do not publish the bot port.
D1 or SQLite stores settings, cases, audit records, encrypted server keys, and dashboard sessions.
Use one bot process initially; do not run duplicate Gateway workers against the same bot.
Bound in-flight Jev work, queued messages, and per-server request budgets.
Run classification in the website server so server-specific Jev keys never reach the bot or browser.
Key selection, missing-key behavior, and deterministic-only operation follow [the runtime contract](../README.md#runtime-and-data).

## Design

The user is a server administrator tuning rules and checking an incident.
Use a quiet dark workspace, readable rule rows, clear action labels, and green only for active protection.
The domain is servers, channels, roles, rules, cases, evidence, and enforcement.
The palette draws from dark chat surfaces, light message text, green presence, amber review, and red removal.
The signature is a message test panel that shows the exact rule and proposed action beside the rules.
Prefer useful rule rows to decorative metric cards, a readable case feed to charts, and explicit status text to color alone.
Use system fonts, monospace IDs, a four-pixel spacing base, and borders for depth.

## Security and limits

Use Discord OAuth with state validation, server-side sessions, secure production cookies, CSRF protection, and current server permissions on each protected request.
Require Manage Server or Administrator permission for configuration and case access.
Check both the server scope and bot permissions before each action.
Recheck message contents and settings before an automatic action to reject stale decisions.
Claim each actual Discord message revision before an action; keep content hashes for freshness checks rather than claim identity.
Encrypt server API keys with authenticated encryption, bind ciphertext to the guild ID, and keep the operator-managed secret outside the database.
Return only key status; clear the password input after a successful save and on a server switch.
Do not store allowed-message text; retain flagged-message evidence for 30 days and purge removed-server data.
Do not execute instructions found inside a Discord message or return raw provider errors to browsers.
Do not expose bot tokens or OAuth tokens in browser state, logs, or URLs.
No automatic bans, billing, plugin marketplace, attachment scanning, or anti-raid system in this version.

## Files and commands

- `apps/bot/`: persistent Discord Gateway client and internal control endpoint.
- `apps/server/`: shared Hono dashboard API, Worker entrypoint, Container supervisor, and Node entrypoint.
- `apps/web/`: React dashboard routes and DaisyUI components.
- `packages/`: shared moderation logic, types, database, and authentication.
- `test/`: focused Node checks and a separate browser fixture.
- `packages/db/migrations/`: shared D1 and SQLite schema; operators apply remote D1 migrations explicitly.
- `compose.yaml`: self-hosted server, bot profile, and persistent database volume.

Setup, deployment, and common commands are maintained in [README](../README.md).

Use named functions, async/await, parameterized SQL, and small modules.
For example, `await store.getSettings(guildId)` always requires an explicit server ID.

## Acceptance checks

1. An unauthenticated or unauthorized user cannot read or modify another server.
2. Monitoring records a case without deleting a message.
3. Enforcement deletes only a matching, current message and records failures accurately.
4. Exceptions, disabled rules, and changed settings prevent enforcement.
5. Invalid Jev output, errors, and request limits leave the message untouched.
6. A server switch clears previous data before loading the next server.
7. Configuration changes persist and appear in the audit history.
8. The dashboard works at desktop and narrow widths with keyboard-accessible controls.
9. Both storage backends preserve atomic batches, settings audit, revision claims, tenant isolation, and persistence.
10. Saved keys remain encrypted and isolated; automatic moderation and the tester select the same server key.
11. Search finds cases beyond the first page and ignores stale responses; exception selectors remain bounded with large option lists.
12. Compose starts without a Cloudflare account, authenticates both RPC directions, and preserves database contents across restarts.

Live Discord OAuth, Jev classification quality, and real moderation require operator credentials and a test server.
Local tests and preview are not proof of live deployment.
