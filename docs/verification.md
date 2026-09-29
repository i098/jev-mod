# Local verification

The original Express/MySQL prototype is preserved on `codex/jev-mod-prototype`.
The selected implementation is the Better-T-Stack, DaisyUI, Effect 3, and Cloudflare version.

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

The main local preview uses ports 3102 and 7102.
The initial MySQL test container is unrelated to the selected implementation and is no longer needed for tests.

## Not verified live

No real Discord or Jev credentials were used.
No real messages were read, sent, deleted, or timed out.
No production D1 database, Worker, or Container was deployed.
Cloudflare account access was inspected, but Container credit eligibility was not confirmed.
Model classification quality, OAuth provider behavior, idle recovery, and deployment rollout remain live acceptance checks.

The no-mistakes delivery gate runs after this local verification and can add fixes and further evidence.
