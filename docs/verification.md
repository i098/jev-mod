# Local verification

The original Express/MySQL prototype is preserved on `codex/jev-mod-prototype`.
The supported runtimes and selected stack are described in the [operator guide](guide.md#stack).

## Completed before the delivery gate

- Ten behavior tests pass, including real local D1 queries through Miniflare.
- TypeScript checks pass.
- The React/DaisyUI website builds with Vite.
- Wrangler dry-run bundles the production Worker and builds the Linux amd64 Container image.
- The bot adapter and Effect Jev module import successfully inside that image without network access.
- Browser checks confirm configuration saves survive reload, settings history updates, server switching clears prior data, and case dismissal updates activity.
- Preview deletion controls are disabled and its server rejects deletion requests.
- The dashboard has no document-level horizontal overflow at 320px or 390px.
- Desktop layout was inspected at 1440px; the tested browser reported no console warnings or errors.

These results predate delivery-gate fixes and do not certify the current commit.
Current validation results belong to the delivery gate's test phase.

## Current regression coverage

The test sources define coverage; their presence is not a new passing-run claim.
`pnpm test` runs the Node test files, including real local D1 through Miniflare and disposable SQLite databases.
Discord and TypeSafe transports use test doubles.

- [D1 and HTTP contracts](../test/d1.test.ts) cover authorization, CSRF, settings compare-and-set, audit atomicity, retention, budgets, and case claims.
- [SQLite and Node hosting](../test/node.test.ts) cover atomic batches, authentication adapter results, automatic migrations, authenticated RPC, address spoofing, and persistence across server restarts.
- [Keys, case filters, and migration compatibility](../test/keys-filtering.test.ts) run against both database adapters and cover encrypted server keys, shared tester/bot key selection, deterministic-only checks, paginated search, and preservation of older cases.
- [Discord actions](../test/discord.test.js), [moderation](../test/moderation.test.js), and [bot lifecycle](../test/bot-lifecycle.test.js) cover current permissions, exemptions, changed revisions including attachment-only edits, duplicate claims, timeout safety, and membership reconciliation.
- [Jev policy](../test/policy.test.js) includes a stalled-response-body regression that requires the original request signal to be aborted on timeout.
- [Worker runtime](../test/container-proxy.test.js) checks the private store bridge, rejects unrelated containers, and covers disabled, connected, unavailable, and invalid health responses locally.
  Its provider regression runs successful Discord server listing and Jev classification in workerd with an isolated outbound fixture.
  Redirect cases verify that requests never reach the untrusted destination.
- [Discord HTTP](../test/discord-http.test.ts) covers the identifying User-Agent, manageable-server filtering, safe failure messages, and status-only error logs with a synthetic transport.

## Browser fixture

[The browser fixture](../test/dashboard.browser.ts) renders the real React dashboard with sample servers, cases, and keys.
It replaces `fetch` and `confirm`, so it does not exercise live providers or browser-native confirmation dialogs.
Coverage includes thousands of exception options, keyboard tabs, explanatory tooltips, phrase and mention controls, shared timeout duration, key save/replace/remove, paginated search, stale-response cancellation, draft preservation, sign-out errors, and canceled or confirmed server switches.
Tooltip checks cover focus and click opening, Escape dismissal, viewport bounds, and keeping help open during focus-induced scrolling.
It is separate from `pnpm test`.

Choose an unused `WEB_PORT` and `API_PORT` pair before starting it from the repository root.
The example ports below must be checked for availability first.

```sh
WEB_PORT=3103 API_PORT=7103 apps/web/node_modules/.bin/vite . --config apps/web/vite.config.ts
```

Open `/test/dashboard.browser.html` at that local web origin in a fresh tab and wait for `PASS` or `FAIL`.
Open `/test/dashboard.browser.html?authError` to exercise the revoked-access error view.
Repeat at desktop and narrow widths; check clipping and document overflow separately.
Serve the repository root as shown, rather than an `/@fs` HTML URL through the app-root server, so Vite supplies the React preamble.
This fixture needs no API server and does not use the preview database.

## Live acceptance checks

Local Node, SQLite, and browser-fixture checks do not prove production Compose operation, live Discord installation or commands, permission revocation against Discord, or actual message enforcement.
Before calling a deployment ready, check the real login and server-list flow, Gateway readiness, monitoring, and moderation in an authorized test server.
Interpret health results using [the runtime health contract](guide.md#runtime-and-data).
Model classification quality, token refresh, permission revocation, idle recovery, and deployment rollback require their own observed checks.
Deployment-specific results belong in the delivery record; do not infer them from a passing fixture or a successful asset upload.
