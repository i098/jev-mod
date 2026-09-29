# Contributing to Jev-Mod

Small fixes, clear bug reports, documentation, and focused improvements are welcome.
Discuss large changes in an [issue](https://github.com/undeemed/jev-mod/issues) before starting.

## Local setup

Requirements: **Node.js 26.7+**, **pnpm 10.33.2**, and a running Docker-compatible engine for the full check command.

1. Fork this repository and clone your fork.
2. Create a branch for your change.
3. Install and start the sample dashboard:

```sh
pnpm install --frozen-lockfile
pnpm dev:setup
pnpm dev
```

Open **http://localhost:3102**; the API uses **7102**.
The preview uses sample data and a local database, with no Discord or Jev connection.
`dev:setup` applies local preview migrations only.
For parallel checkouts, choose unused frontend/API ports and follow the [preview configuration guide](docs/guide.md#local-preview).

## Project layout

| Path | Purpose |
| --- | --- |
| `apps/web` | React dashboard |
| `apps/server` | HTTP API, authentication, and hosting entrypoints |
| `apps/bot` | Discord Gateway connection and moderation actions |
| `apps/site`, `docs` | Landing Worker, static site, policies, and documentation |
| `packages/core` | Moderation rules and TypeSafe Jev integration |
| `packages/db`, `packages/auth` | Storage and shared authentication |
| `test` | Behavior tests and browser fixture |

## Make the change

- Keep changes focused; avoid unrelated refactors and new dependencies without a clear need.
- Follow the existing TypeScript, Effect 3, React, Hono, and Drizzle patterns.
- Preserve server isolation, permission checks, cancellation, and safe failure behavior.
- Use synthetic credentials and provider fixtures in tests.
- Add a regression check for behavior changes; check UI changes in a real browser, including narrow screens and keyboard navigation.
- Update relevant documentation and retain third-party license notices.

Do not commit keys, tokens, private messages, local databases, or operator configuration.
Do not run remote migrations, deploy services, or perform real Discord moderation as part of tests.

## Check your work

```sh
pnpm test
pnpm check
```

`check` runs TypeScript checks, builds the dashboard, and dry-runs the Worker and Container build.
It needs Docker to be available; a dry run does not deploy the service.
See the [verification guide](docs/verification.md) for the separate browser fixture and evidence limits.

## Open a pull request

- Explain the problem, resulting behavior, and how you checked it.
- Include screenshots for visible UI changes.
- State any checks you could not run; do not describe fixtures as live provider verification.
- Keep the PR small enough to review and respond to review feedback.

Maintainers handle release and deployment.
Contributions are submitted under the project’s [MIT license](LICENSE).

## Report bugs and security issues

For ordinary bugs, [open an issue](https://github.com/undeemed/jev-mod/issues) with reproduction steps, expected behavior, and hosting option.
Remove secrets and private server content from logs and screenshots.

For vulnerabilities or exposed credentials, email **[dev@42nights.inc](mailto:dev@42nights.inc)** privately instead of opening a public issue.
