# TypeScript + Next.js + PostgreSQL Hello World

This is the first host-container application used by SwarmForge's TypeScript
pipeline. It presents a minimal accessible Hello World page and exposes a
PostgreSQL-backed health endpoint.

## Run locally

The target runtime is Node `24.13.0` (`.nvmrc` and Dockerfile) with canonical
npm `9.2.0` (`packageManager`). Use `npm ci`; the lockfile is also checked with
the retained Linux Node `22.22.1`/npm `9.2.0` sandbox for optional-dependency
portability. `npm ci --ignore-scripts` is the dependency-preparation command
used by SwarmForge's project-local tool cache.

```sh
npm ci
docker compose up db
npm run migrate
npm run dev
```

Open <http://localhost:3000>. The production-shaped path is:

```sh
docker compose up --build
```

Only `app` publishes a host port. PostgreSQL is reachable through Compose's
internal network through the private Compose network. `docker compose down`
stops services while retaining the named database volume.

## Verification

The exact project commands are `npm ci`, `npm run typecheck`, `npm run lint`,
`npm test`, `npm run test:property`, `npm run test:acceptance`,
`npm run test:mutation:source`, `npm run test:acceptance:mutation`,
`npm run quality:crap`, `npm run quality:dry`, `npm run test:e2e`,
`npm run test:e2e:headed`, and `npm run verify:container`. The acceptance
command uses SwarmForge's pinned APS parser and IR DRY checker for every
feature, then generates and runs TypeScript entrypoints. Source mutation uses
fresh Stryker output against the application sources under `lib` (excluding
`lib/db.ts`), with a 100% threshold. Acceptance mutation uses the APS mutator
at differential hard level with four workers and exercises every feature.
CRAP uses fresh Istanbul JSON coverage and a
threshold of 10, discovering the covered production files instead of carrying
a hand-written file list. jscpd scans `lib` and `app` with a zero-duplication
threshold, excluding tests and generated output. The non-production mutation
runner serializes its reset-and-scenario critical section across APS workers
so a shared test database cannot cross-contaminate mutations.

`test:e2e` is UI-only Playwright verification. Set `BASE_URL` to an already
running app (and install Chromium once with `npx playwright install chromium`).
The acceptance scenarios that control PostgreSQL require an isolated Compose
project, for example `COMPOSE_PROJECT_NAME=hello-world-acceptance` alongside
`BASE_URL` when running `npm run test:acceptance`.
`verify:container` is the host-only check: it chooses a free port and unique
Compose project, records the commit/image/logs, runs the browser flow, checks
PostgreSQL outage and recovery, rebuilds only the app, and removes only its
test volume. It assumes
Docker Desktop is available on the host; a sandbox must not be assumed to share
the host Docker daemon. `npm run verify:pipeline` runs the complete ordered
pipeline, including the container gate.

Architecture verification on 2026-09-09 passed local unit and property tests,
type checking, lint (including the core import boundary), CRAP, duplication,
source mutation (16/16 killed), the production build, and the Hello World
acceptance scenario. Per operator clarification
`clar-20260909T043000101340675Z`, PostgreSQL Compose and outage/recovery checks
are deferred until the merged project runs on the host. The Docker Sandbox
intentionally does not expose the host Docker socket; this limitation does
not block the architecture handoff. These host-only checks have not been
verified by this architecture pass.

For SwarmForge's canonical toolchain, run
`swarmforge/scripts/runtime_preflight.sh --runtime local --skip-docker` before
local checks and use `swarmforge/scripts/create_typescript_fixture.sh` to make
an independent Git fixture with a unique Compose project, port, and volume.

Keep the starter's Node/npm and dependency versions pinned. Use `npm ci`; do
not silently update dependencies during a normal role run.
