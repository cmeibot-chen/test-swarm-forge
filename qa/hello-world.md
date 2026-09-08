# Hello World headed QA

Task: hello-world (QA). Run against the production Compose application in a
visible browser. Use only browser navigation, browser developer tools, and
Docker Compose's public CLI. Do not call project APIs from scripts, import
application modules, query the database directly, or mock health responses.
Navigating to `/api/health` in the browser is the health path's user interface.

## Setup

Use an isolated Compose project and an unused host port in this worktree:

```sh
export COMPOSE_PROJECT_NAME=hello-world-qa
export APP_PORT=3107
docker compose up -d --build
```

Wait for PostgreSQL to be healthy and the app to serve requests. Record the
commit, browser, port, and command outcomes. A startup failure fails this suite.

## Hello World 01 — page and accessibility

1. Open `http://localhost:3107/` in the visible browser.
2. Verify the document title is exactly `Hello World`. There is one visible
   level-one heading, exactly `Hello World`, inside a main landmark. Inspect
   the browser accessibility tree to confirm those semantics.
3. Verify there is no todo entry form or todo list and no todo-facing copy.
4. Reload. The same greeting remains visible without interaction or errors.
5. At desktop size and a 375-pixel-wide viewport, verify the greeting is
   readable, unclipped, and has no horizontal page overflow. At 200% zoom,
   verify it remains readable. Check that the greeting has sufficient text
   contrast and that any interactive elements are keyboard reachable with
   visible focus; no interactive elements are required.

## PostgreSQL health 01 — real dependency and recovery

1. Open browser developer tools Network, disable cache, and navigate directly
   to `http://localhost:3107/api/health`. Verify HTTP 200 and a JSON document
   whose `status` is exactly `ok`.
2. Run `docker compose stop db`. Reload the health URL. Verify HTTP 503 and
   JSON `status` exactly `unavailable`; a stale success or hanging request fails.
   The response must not expose database credentials or a stack trace.
3. Run `docker compose start db`, wait for it to be healthy, and reload the
   health URL. Verify HTTP 200 and JSON `status` exactly `ok` without rebuilding
   or restarting the app. This sequence proves health follows the real database.

## Production rebuild

1. Run `docker compose up -d --build --no-deps app`.
2. Repeat the root-page greeting check and successful browser health check.
3. Record screenshots of the page and health results, including Network status
   for the outage and recovery, plus Compose startup/rebuild outcomes.
4. Always restore the database if interrupted. Finish with `docker compose down`
   using the same project name. Keep volumes; this suite requires no user data.

## Delivery gates

Coder must replace the starter todo browser test with UI-only Playwright checks
for the greeting, semantics, absent todo UI, and browser navigation to health.
Keep both `npm run test:e2e` and `npm run test:e2e:headed` usable with `BASE_URL`.
Update acceptance wiring to execute every scenario/example in both feature files
and compare the parameterized expected values against actual responses. Retain
real PostgreSQL outage/recovery coverage with isolated, serialized lifecycle
control so parallel checks cannot stop each other's database.

Retain the pinned TypeScript/Next.js App Router/Tailwind/PostgreSQL/npm stack and
production Docker Compose startup. Adapt the container gate to the greeting,
health, and app rebuild instead of todo creation/persistence. Keep the configured
TypeScript, npm test, acceptance, browser, and container gates runnable; downstream
roles run their assigned quality gates. This specification stage validates
Gherkin parsing and DRY only and does not claim implementation tests have passed.

## Specification audit

| Card requirement | Specification evidence | Implementation status at handoff |
| --- | --- | --- |
| Clear Hello World root; replace todo UI | Hello World 01; headed page steps 1–4 | Coder must replace starter page, title, and todo-facing documentation |
| Minimal, accessible page | Main landmark and heading assertions; headed page step 5 | Coder implementation and browser verification pending |
| Real PostgreSQL health | PostgreSQL health 01 reachable/unreachable examples; headed outage/recovery | Existing endpoint contract retained; executable acceptance wiring pending |
| Required stack and production Compose | Imported pinned starter; Setup and Production rebuild | Coder retains stack and adapts container gate |
| Acceptance and browser QA | Both feature files and this headed suite | Coder replaces todo handlers, hardcoded feature paths, and browser test |
| TypeScript/npm/acceptance/UI/container gates | Delivery gates above and existing package scripts | Downstream execution pending; no gate success claimed |

Both features parsed successfully and produced zero IR-DRY findings. Greeting
and title remain separate expected parameters because either can regress
independently. HTTP status and JSON status likewise assert different outputs.
No acceptance mutation was run by specifier. The imported application and tests
are the starting implementation, not a completed Hello World implementation.
No generated artifacts or scratch files are committed. Unrelated local agent
configuration edits remain outside this delivery.
