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

- [ ] **T1** (S1, S2, S3) Backend domain, persistence, HTTP/WS and migration · route: inline · commit: —
- [ ] **T2** (S4) Admin API and panel: companies, routes, user membership · route: inline · commit: —
- [ ] **T3** (S5) Mobile: company dropdown on the driver screen, data-driven routes · route: inline · commit: —

## Log

- **L1** (2026-11-25) Original request, verbatim: "en el proyecto carreras modifica el backend para que soporte diferentes empresas para cada ruta, donde cada usuario debe estar registrado como parte de cierta empresa para ver una ruta en particular. de momento deja las 3 existentes como parte de la ruta "eureka", haz los cambios necesesarios en el panel de control para manejar que usarios pertenecen a que empresas, y por ultimo en la vista de usuarios que solamente el chofer pueda seleccionar en un menu desplegable a que empresa desea ver y ejecutar las rutas"
- **L2** (2026-11-25) Asked what routes a new company has. User chose "Rutas propias por empresa": routes are data per company, managed from the admin panel; Eureka keeps Mañana, Norte and Sur.
- **L3** (2026-11-25) Routes: all inline, no writer trigger (units depend on the backend contract, written one after another). Risk: item 1 (schema migration of existing trips/users) and item 2 (membership authorization). No Docker daemon or local Postgres in this environment, so the Postgres adapters and the migration cannot be executed here.
