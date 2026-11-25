# Multi-company routes

Objective: every route belongs to a company; users only see and run the routes of the companies they are registered in.
Branch: `feat/multi-company` · Delivery: ask-on-risk (no PR requested yet; chain strategy to be chosen when one is) · Test runner: vitest (backend), `tsc --noEmit` + vitest (mobile).

## Specs

- **S1** "modifica el backend para que soporte diferentes empresas para cada ruta". Decision (L2): routes become data owned by a company (name, rotation order, kind `pickup` with map/GPS or `dropoff`). Each company has its own active trip and its own rotation.
- **S2** "cada usuario debe estar registrado como parte de cierta empresa para ver una ruta en particular". A user who is not a member of a company can neither read nor act on its trips, over HTTP or WebSocket, including the driver location.
- **S3** "de momento deja las 3 existentes como parte de la ruta \"eureka\"". Existing databases migrate to a company "Eureka" holding Mañana (pickup), Norte and Sur (dropoff); existing trips and every existing user are attached to it.
- **S4** "haz los cambios necesesarios en el panel de control para manejar que usarios pertenecen a que empresas". The admin panel assigns companies to users, and (consequence of L2) manages companies and their routes.
- **S5** "en la vista de usuarios que solamente el chofer pueda seleccionar en un menu desplegable a que empresa desea ver y ejecutar las rutas". Only the driver screen has the company dropdown; the passenger screen has none.

Assumptions (not stated by the user):
- A1: a passenger belongs to exactly one company (they have no selector); a driver belongs to one or more.
- A2: trips of different companies can run at the same time. The driver's GPS is only relayed to the trips that driver started.
- A3: a company with members or a running trip cannot be deleted.

## Tasks

- [x] **T1** (S1, S2, S3) Backend domain, persistence, HTTP/WS, admin API and migration · route: inline · commit: 518cedb
- [x] **T2** (S4) Admin panel: companies, routes, user membership; Postgres migration test · route: inline · commit: 982e574
- [x] **T3** (S5) Mobile: company dropdown on the driver screen, data-driven routes; README · route: inline · commit: 623be54

## Log

- **L1** (2026-11-25) Original request, verbatim: "en el proyecto carreras modifica el backend para que soporte diferentes empresas para cada ruta, donde cada usuario debe estar registrado como parte de cierta empresa para ver una ruta en particular. de momento deja las 3 existentes como parte de la ruta "eureka", haz los cambios necesesarios en el panel de control para manejar que usarios pertenecen a que empresas, y por ultimo en la vista de usuarios que solamente el chofer pueda seleccionar en un menu desplegable a que empresa desea ver y ejecutar las rutas"
- **L2** (2026-11-25) Asked what routes a new company has. User chose "Rutas propias por empresa": routes are data per company, managed from the admin panel; Eureka keeps Mañana, Norte and Sur.
- **L3** (2026-11-25) Routes: all inline, no writer trigger (units depend on the backend contract, written one after another). Risk: item 1 (schema migration of existing trips/users) and item 2 (membership authorization). No Docker daemon or local Postgres in this environment, so the Postgres adapters and the migration cannot be executed here.
- **L4** (2026-11-25) Design decisions: trips store a snapshot of the route name/kind (editing or deleting a route never changes a running trip) plus `driver_id`; trip endpoints take `?companyId=` (optional with one company, `400 COMPANY_REQUIRED` with several); `/ws` auth takes `companyId` and closes `4403` when the company is not available; an admin change of role/companies drops that user's sockets (close code 1012). Mobile dropdown is a custom modal (no new native dependency, same on web) in the layout's top bar, locked while the selected company has a route in progress so GPS sharing stays coherent.
- **L5** (2026-11-25) Evidence. Docker Desktop was started and a throwaway `postgres:17-alpine` container used (removed afterwards): `TEST_DATABASE_URL=... npx vitest run` in backend: 7 files, 138 passed (in-memory + Postgres contract + migration of a pre-company database). Without a database: 112 passed, Postgres parts skipped. Backend and mobile `tsc --noEmit`: clean. Mobile `npm test`: 29 passed. Nine mutations of the isolation rules (membership checks, hub fan-out, GPS relay, push scoping, per-company trip, passenger single company, company delete guard, socket drop) were each caught by at least one test. Real server smoke on the throwaway database: seed, `/admin` page 200, admin companies list, driver login with companies, trip start, `create-user --company`.
- **L6** (2026-11-25) Not verified: the admin panel and the mobile screens were not opened in a browser or device (logic covered by API tests, typecheck and `node --check` only). Mobile has no lint configuration. The RED step was not observed separately for T1: tests and implementation landed in the same run; the mutation run in L5 stands in for it. Receipt-driven development is off (global), so no native review was started. Running count: about 3,700 changed lines in 3 commits, far over the 400-line slice heuristic; slicing into PRs is pending the user's choice.
- **L7** (2026-11-25) Independent verifier (in-memory, 43 probes): S1, S2, S4, S5 PASS, no blockers; S3 unproven for it (no Postgres there) but run by the parent in L5. Accepted from it: the admin API now rejects a route list that repeats a route id. Left open: the driver selector locks on any running trip of the company, even one another driver started (needs a `startedByMe` flag to narrow); `scripts/set-role.ts` bypasses the company-count and running-trip guards; a join racing an admin move can leave a passenger in the old company's trip.
