# Jev-Mod

## Objective

Build a public Discord moderation bot and web dashboard that any server administrator can install.
Use TypeSafe Jev to evaluate unwanted text and familiar moderation controls from YAGPDB and Red.
The implementation is original; no reference-project code is copied.
See [the source research](oss-moderation-research.md).

## Product behavior

- Discord login lists servers that the user can manage and provides an installation link.
- Each server has separate rules, role and channel exceptions, cases, and settings.
- Jev checks spam, scams, hate speech, harassment, threats, and sexual content, with editable instructions and thresholds.
- Rules can log, delete, or delete and timeout a member.
- Simple local rules check blocked phrases and excessive mentions.
- New servers start in monitoring mode; an administrator enables enforcement in the dashboard.
- New messages and text edits are evaluated; bot messages and direct messages are excluded.
- The dashboard offers rules, a message tester, activity, case review, and server settings.
- Cases show the rule, model, probability, requested action, and actual outcome.
- Unknown, failed, overloaded, or stale decisions never trigger an automatic punishment.
- Jev evaluates text only; image and attachment contents are outside this version.
- Jev decisions remove messages after posting, not before Discord displays them.

## Implementation

Use the user-approved Better-T-Stack selection: React, TanStack Router, DaisyUI, Hono on Workers, Better Auth, Drizzle, and Cloudflare D1.
Use stable Effect 3 for typed model errors, request timeouts, and cleanup.
Serve the built dashboard and API from the same Cloudflare Worker origin.
Run discord.js in a Cloudflare Container with a private outbound handler for D1 access.
D1 stores settings, cases, audit records, and dashboard sessions.
Target the user's 42nights Cloudflare account; verify the account and Container credit eligibility before deployment.
Use one bot process initially; do not run duplicate Gateway workers against the same bot.
Bound in-flight Jev work, queued messages, and per-server request budgets.
Keep the Jev key and Discord credentials on the server.

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
Persist a unique case before performing an action to prevent duplicate handling.
Do not store allowed-message text; retain flagged-message evidence for 30 days and purge removed-server data.
Do not execute instructions found inside a Discord message or return raw provider errors to browsers.
Do not expose bot tokens or OAuth tokens in browser state, logs, or URLs.
No automatic bans, billing, plugin marketplace, attachment scanning, or anti-raid system in this version.

## Files and commands

- `apps/bot/`: persistent Discord Gateway client and internal control endpoint.
- `apps/server/`: Hono dashboard API, Worker entrypoint, and Container supervisor.
- `apps/web/`: React dashboard routes and DaisyUI components.
- `packages/`: shared moderation logic, types, database, and authentication.
- `test/`: focused Node test runner checks.
- `packages/db/migrations/`: checked-in D1 schema; operators apply remote migrations explicitly.
- `pnpm dev:setup`: initialize the local preview database.
- `pnpm dev`: run the loopback preview on ports 3102 and 7102.
- `pnpm test`: execute behavior checks.
- `pnpm check`: typecheck, build the website, and dry-run the Worker and Container build.
- `pnpm deploy`: publish after account, database, domain, and secrets are configured.

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

Live Discord OAuth, Jev classification quality, and real moderation require operator credentials and a test server.
Local tests and preview are not proof of live deployment.
