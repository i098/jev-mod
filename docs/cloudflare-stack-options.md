# Jev-Mod: Cloudflare and Better-T-Stack options

Checked on 2026-09-28 using current official documentation and npm registry metadata.
This records the research, not proof of a deployed bot or of credit eligibility in the 42nights account.

## Selected implementation

The user selected React with TanStack Router, DaisyUI, Hono on Workers, Better Auth, Drizzle, D1, Effect 3, and a discord.js Container.
The Worker serves the built React assets and Hono API from one origin.
The current generator emits prerelease Alchemy 2 and Effect 4 infrastructure; the implementation uses Wrangler so it can keep stable Effect 3 and explicit Container supervision.
The alternative below remains research context, not the selected frontend.

## Recommendation

Use Better-T-Stack for the website, with React, TanStack Start, Better Auth, Drizzle, D1, and Effect for application logic.
Run the Discord Gateway connection through `discord.js` in one Cloudflare Container with a stable instance name.
Keep configuration and moderation cases in D1, accessed from the container through a small Worker outbound handler.
Do not implement a custom Discord Gateway client inside a Durable Object.

The smallest website shape is a full-stack TanStack Start Worker.
A separate Hono Worker is also supported if a distinct API service is wanted.
The bot container remains separate in either shape.

## Better-T-Stack generation constraints

Two supported configurations fit this project:

| Website shape | Required selections |
| --- | --- |
| One full-stack TanStack Start application | `--frontend tanstack-start --backend self --runtime none --web-deploy cloudflare` |
| Website plus separate Hono API | `--frontend tanstack-router` or `tanstack-start`, then `--backend hono --runtime workers --server-deploy cloudflare --web-deploy cloudflare` |

Both can use `--database sqlite --orm drizzle --db-setup d1 --auth better-auth`.
The generator requires an ORM when a database is selected.
The explicit `workers` server runtime requires Hono; it does not support Express, Fastify, or Elysia.
The `self` backend puts server routes inside the web application and uses `runtime none`.
D1 with `self` requires Cloudflare web deployment and a supported full-stack frontend, which includes TanStack Start.
[Compatibility rules](https://www.better-t-stack.dev/docs/cli/compatibility), [CLI options](https://www.better-t-stack.dev/docs/cli/options).

Cloudflare targets generate a `packages/infra/alchemy.run.ts` workspace.
Alchemy manages application deployment, D1 bindings, and checked-in database migrations.
A generated deployment can apply migrations; generation alone does not deploy resources.
Review the generated infrastructure and select the correct account before any deployment.
The generator's Cloudflare server target means Workers, not an automatically generated Discord bot Container.
The container and its supervisor require additional infrastructure configuration.
[Alchemy deployment guide](https://www.better-t-stack.dev/docs/guides/cloudflare-alchemy).

Cloudflare also officially supports TanStack Start through its Vite plugin and a custom server entrypoint.
That entrypoint can export Durable Objects and add scheduled handlers.
This supports one website Worker owning the container binding, although the actual generated setup must be checked before extending it.
[TanStack Start on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/).

## Container lifecycle requirements

Cloudflare Containers run a Linux image and require `linux/amd64` builds.
Container disk is ephemeral, so it cannot be the durable database.
A Durable Object manages each container and retains its own persistent storage across restarts.
[Container architecture](https://developers.cloudflare.com/containers/concepts/architecture/).

Concrete supervision requirements:

- Use one stable `getContainer` name per Discord Gateway shard; do not use random instance selection.
- The default idle timeout is 10 minutes and follows incoming activity, not a documented guarantee about Discord traffic inside the container.
- Override `onActivityExpired()` without stopping while the bot is enabled; the timer renews and the hook runs again.
- Alternatively, reset the timer with `renewActivityTimeout()` from scheduled checks.
- Use `schedule()` for recurring checks; do not override the `Container` class's `alarm()` handler.
- Use lifecycle hooks for startup, exit reporting, and controlled restart attempts.
- A listening health endpoint and a healthy container do not prove that Discord Gateway is connected; health must include Gateway readiness.

These are design recommendations using documented lifecycle methods.
[Container interface](https://developers.cloudflare.com/containers/reference/container-class/).

There is no fixed maximum container runtime, but Cloudflare guarantees no minimum uninterrupted runtime either.
Host maintenance and deployments can stop a running container even when idle shutdown is disabled.
The platform sends `SIGTERM`, allows up to 15 minutes, then sends `SIGKILL` if required.
After a host stop, another instance may start when traffic requests it again.
Therefore, add a periodic Worker scheduled handler that addresses the same container and checks or starts it.
Do not depend only on future dashboard traffic to recover the bot.
[Runtime FAQ](https://developers.cloudflare.com/containers/faq/), [scheduled Container example](https://developers.cloudflare.com/containers/examples/cron/).

Deploying Worker code and replacing container images are not one transaction.
Worker code can become active while an old image still runs, or while image rollout fails.
Keep the Worker-to-container protocol compatible across the rollout and verify actual container readiness after deployment.
[Container rollouts](https://developers.cloudflare.com/containers/configuration/rollouts/).

## Container access to D1

The Node process does not receive a Worker-style `env.DB` binding directly.
Cloudflare documents outbound handlers that intercept container HTTP requests and execute inside Workers with access to D1 and other bindings.
A container can call a virtual hostname, while the handler validates the request and uses the D1 binding.
The handler context includes the container ID for scoping access.
This is a supported private bridge; it does not require a public D1 proxy or an account-wide Cloudflare API token inside the bot.
Expose only specific configuration and case operations, not arbitrary SQL.
[Connect Containers to Workers and bindings](https://developers.cloudflare.com/containers/configuration/workers-connections/).

Keep the configuration schema and case schema shared between the website and bot.
Use the Worker binding for D1 operations; the recommendation does not require installing an Effect SQL layer alongside Drizzle.
[D1 binding API](https://developers.cloudflare.com/d1/worker-api/).

## Why an outbound WebSocket Durable Object is a poorer baseline

Durable Objects can connect to external WebSocket servers, but outbound WebSockets cannot hibernate.
They remain in memory and incur duration charges.
Each outbound connection prevents eviction for at most 15 minutes; after that, ordinary eviction rules resume.
This is not a hard 15-minute connection limit: the socket can continue operating.
Code updates disconnect WebSockets, and runtime changes can also restart the object.
There is no guaranteed pre-shutdown hook for preserving state.
[WebSocket behavior](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).

A native Durable Object Gateway adapter would therefore need explicit recovery, session persistence, heartbeat handling, and Discord protocol integration.
Using the existing Node Discord library in a container avoids making that custom adapter part of this project's first version.
The container still needs restart testing and event deduplication; it does not guarantee uninterrupted message observation.

## Effect and version choices

The npm registry returned these versions during this research:

- `create-better-t-stack`: `3.44.2`.
- `effect` latest: `3.22.2`.
- `effect` release-candidate tag: `4.0.0-rc.118`.
- `effect` beta tag: `4.0.0-beta.107`.
- `discord.js`: `14.27.0`.

Use the stable Effect 3 release unless the user explicitly chooses Effect 4 release-candidate APIs.
Effect is not one of Better-T-Stack's listed generator backend or API options; add it to application services after generation.
Use it for typed Jev errors, request timeouts, bounded retries, and resource cleanup.
Keep Hono or TanStack Start as the HTTP entrypoint.
Effect's official v3 package index includes D1 and Drizzle integrations, but adding either is optional when the generated Drizzle binding already works.
[Effect v3 API index](https://effect.website/docs/v3/api), [Effect registry](https://registry.npmjs.org/effect), [Better-T-Stack registry](https://registry.npmjs.org/create-better-t-stack), [discord.js registry](https://registry.npmjs.org/discord.js).

## Credits and deployment evidence

Containers require the Workers Paid plan.
Container billing includes provisioned memory and disk while running, active CPU, and applicable network usage; Workers and Durable Objects are billed separately.
An always-running bot does not receive scale-to-zero savings.
[Container pricing](https://developers.cloudflare.com/containers/platform/pricing/).

The public startup program lists Workers, Durable Objects, D1, and several other eligible services, but does not explicitly list Containers in its coverage summary.
That omission does not prove either eligibility or exclusion.
The 42nights account's credit balance, expiry, service coverage, and paid-plan status were not accessed.
Confirm those account facts before promising that credits cover the bot Container.
Cloudflare states that credits cannot transfer between accounts.
[Current startup program](https://www.cloudflare.com/startups/).

Before describing the deployment as ready, verify a real Discord connection, an idle period longer than the configured timeout, forced process recovery, and an image rollout.
Also verify that D1 cases survive the restart and that one Discord event cannot produce duplicate sanctions.
