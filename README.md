# Rheo

A transport app with two roles. The **driver** starts a route. **Passengers** get a push notification and can tap "Usaré el transporte", and they show up live in the driver's list. The driver confirms each stop and finishes the route once every stop is confirmed. Routes rotate on every start: **Mañana → Norte → Sur → Mañana**.

| Folder | What | Stack |
|---|---|---|
| `backend/` | API + realtime | Node 24+ (runs TypeScript natively), Fastify, PostgreSQL, WebSocket |
| `mobile/` | Driver and passenger app | Expo (React Native), Expo Router |
| `odd/tasks/` | Feature specs and progress log | — |

## Run the backend

```bash
# 1. Secrets (never commit them). JWT_SECRET needs 32+ characters.
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
export POSTGRES_PASSWORD=change-me

# 2. Start Postgres + API on http://localhost:3000
docker compose up -d --build

# 3. Demo users (password: carreras123): chofer@carreras.dev, usuario1..4@carreras.dev
docker compose exec api node scripts/seed.ts
```

Instead of exporting variables, you can put them in a `.env` file next to `docker-compose.yml`. Docker Compose reads it automatically. Without `JWT_SECRET`, compose refuses to start on purpose.

On Windows PowerShell, create the `.env` file with:

```powershell
$secret = node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
"JWT_SECRET=$secret" | Set-Content -Encoding ascii .env   # ascii: no BOM, which compose cannot parse
docker compose up -d --build
```

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | yes | 32+ characters |
| `POSTGRES_PASSWORD` | recommended | defaults to `carreras` |
| `EXPO_ACCESS_TOKEN` | no | only if "enhanced push security" is enabled in Expo |
| `ADMIN_PASSWORD` | no | master password for the admin panel (12+ characters); empty disables it |

This is a **private app: there is no self sign-up**. Only an administrator creates accounts, from the [admin panel](#admin-panel) or with these scripts:

```bash
# Create a passenger in a company (or --role driver, repeating --company for each company they drive for)
docker compose exec api node scripts/create-user.ts \
  --email ana@example.com --password 'min-8-chars' --name "Ana" --address "Calle 1 #23" --role passenger --company Eureka

# Change an existing account's role (the app switches screens the next time it opens)
docker compose exec api node scripts/set-role.ts --email ana@example.com --role driver
```

The schema is applied automatically on every boot (`backend/src/infrastructure/postgres/schema.sql`). A database created before companies existed is upgraded on that boot: its users, trips and the routes Mañana, Norte and Sur become the company **Eureka**.

### Companies and routes

Every route belongs to a **company**, and users only see and run the routes of the companies they are registered in.

- A company has its own ordered list of routes. Each started trip takes the next one in that order, and each company rotates on its own. A route is either **pickup** (passengers see the driver on the map, the phone shares GPS) or **dropoff** (no map, no GPS).
- Each company has its own trip: two companies can have a route in progress at the same time, with separate passenger lists, notifications and live state.
- A **passenger** belongs to exactly one company. A **driver** belongs to one or more and picks which one to work with from the dropdown at the top of the driver screen; the choice is locked while that company has a route in progress. The driver's position is only shared with the trip that driver started.
- Companies, their routes and who belongs to each are managed in the [admin panel](#admin-panel).

### Deploy the API anywhere

The API is one container plus Postgres, so it runs on any host that runs Docker (VPS, Fly.io, Railway, Render, a home server).

1. Push to GitHub. `.github/workflows/ci.yml` runs typecheck and tests (backend against a real Postgres, mobile typecheck). On `main` and `v*` tags, `docker.yml` publishes `ghcr.io/<owner>/<repo>-api` to GitHub Container Registry.
2. On the server, with a TLS reverse proxy in front of port 3000:

```bash
export API_IMAGE=ghcr.io/<owner>/<repo>-api:main
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
export POSTGRES_PASSWORD=<strong-password>
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec api node scripts/create-user.ts --email you@example.com --password '...' --name "You" --role driver
```

3. Point the app at it: `EXPO_PUBLIC_API_URL=https://api.example.com` when building the mobile app (see `mobile/eas.json`).

| Extra variable | Notes |
|---|---|
| `TRUST_PROXY` | `true` behind a reverse proxy (the prod compose defaults to it) so the login throttle sees real client IPs. Leave `false` if the API is exposed directly. |
| `PORT` / `HOST` | default `3000` / `0.0.0.0` |

The image has a `HEALTHCHECK` on `/health`. WebSockets need proxy support for upgrades (Caddy and Fly do it by default; in nginx add `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`). If the package is private on GHCR, run `docker login ghcr.io` on the server with a token that has `read:packages`.

### Deploy on Railway (API + web app)

Railway builds each folder from its `Dockerfile` and gives every service an HTTPS domain. In one Railway project, connected to this GitHub repository:

1. **Postgres**: add the PostgreSQL database.
2. **API** service: root directory `backend`. Variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `JWT_SECRET` (32+ characters), `TRUST_PROXY=true`, optionally `ADMIN_PASSWORD`. Set the healthcheck path to `/health` and generate a domain. Migrations run on startup.
3. **Web** service: root directory `mobile`. Variable: `EXPO_PUBLIC_API_URL=https://<api domain>` (it is baked in at build time, so redeploy the web service when it changes). Generate a domain.

Pick the branch each service deploys from in its settings. The web service is the PWA: `mobile/Dockerfile` runs `expo export` and serves `dist/` with Caddy (`mobile/Caddyfile`, single-page fallback, `no-cache` on everything except hashed `/_expo/static/` files so new deploys reach installed apps). Open its domain in Chrome on Android and use **Install app**, or **Add to Home Screen** in Safari on iOS. On web, the driver's location is only shared while the app is open on screen.

### Self-host the web app (any Docker host)

Separate from Railway: `docker-compose.web.yml` + `deploy/web/` build the PWA into a Caddy image and never touch `mobile/Dockerfile`. It needs an API reachable over HTTPS (the API URL is baked into the bundle, so rebuild when it changes).

```bash
EXPO_PUBLIC_API_URL=https://api.example.com docker compose -f docker-compose.web.yml up -d --build
```

Serves plain HTTP on port 80 (`WEB_PORT` to change it). Set `SITE_ADDRESS=app.example.com` for automatic HTTPS (ports 80/443 open, DNS pointing at the host).

### Develop and test

```bash
cd backend
npm install
npm test           # domain, HTTP, realtime and in-memory contract tests
npm run typecheck

# Also run the repository contract and the schema migration against a real Postgres:
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/test npm test
```

## Run the app

The app is **portrait only**. On phones it is locked by `app.json` (`orientation`, plus `ios.requireFullScreen` so iPads honor the lock). Browsers cannot lock orientation, so on a phone or tablet in landscape the web build shows a "Gira tu dispositivo" screen; desktops are never blocked.

```bash
cd mobile
npm install
# On a physical phone, use your computer's LAN IP, not localhost:
EXPO_PUBLIC_API_URL=http://192.168.1.50:3000 npx expo start
```

In the Expo terminal:

- Press **`w`** to open the app in the browser.
- Scan the QR code with **Expo Go** to open it on a phone.

To test both roles at once, use a second browser window in incognito mode. It gets its own session, because each window keeps its session in its own `localStorage`. For example, the driver in one window and a passenger in the other.

> On web, the session lives in `localStorage` and there are no push notifications. That is fine for testing, but a production web client should use an httpOnly cookie.

**Push notifications** need two things:

1. A physical device.
2. A linked EAS project: `npx eas-cli@latest init`.

Expo Go does not support remote push on Android, so use a development build: `npx expo run:android`, or `eas build --profile development`. Without push, everything else still works: the app updates in realtime while it is open.

## Live driver map (testing without driving)

Passengers who joined the active trip see the driver as a pin on a map. The driver's position is relayed over `WS /ws/location` and is never stored: it lives only in memory, and only while a trip is active. The map uses MapLibre with free OpenFreeMap tiles (no API key) on both platforms: `maplibre-gl` on **web** and `@maplibre/maplibre-react-native` on **phones**, which needs a development build (`npx expo run:android` / `run:ios`). In Expo Go, or in a development build made before the map was added, the rest of the app works and a placeholder replaces the map.

The driver's phone shares its real GPS **only while a trip is open**, and keeps sharing with the phone locked or the app in the background (Android shows a persistent "Ruta en curso" notification; iOS shows the blue location pill). It reports over `POST /location`, because the OS suspends WebSockets in the background, about every 5 s while moving and every 10 s while parked. The parked heartbeat is what tells passengers the driver is still connected: the map marks the position as outdated ("Ubicación desactualizada") after 30 s without a report, measured with the age the server sends along (`ageMs`), so phone clocks do not matter. The server pings location sockets every 25 s, and the passenger app reopens one that has been silent for 45 s. Tracking stops when the driver finishes the trip, signs out, or the server answers `409 NO_ACTIVE_TRIP` (this covers an app killed mid-trip). If the driver refuses "Always" location, it is shared only while the app is open, and the driver screen says so. On web it is foreground only.

Background location needs a **development build** (`npx expo run:android` / `run:ios` or EAS); Expo Go cannot run it. On Android, choose "Allow all the time" when asked.

To test it, let a simulated driver drive laps around a point while you watch as a passenger in the browser:

```bash
cd backend
npm run simulate:driver -- --start-trip                      # laps around the default point
npm run simulate:driver -- --lat 10.5 --lng -66.9 --radius 600 --lap 90
```

Then log in as a passenger at http://localhost:8081, tap "Usaré el transporte", and watch the pin move. Drag the map to stop following the driver, and tap "Centrar en el chofer" to follow again.

**"Driver nearby" alert.** When the driver is within ~200 m, the passenger gets a notification (once per trip), the map border turns from green to the ticket's yellow, and the header shows "¡El chofer está a menos de 200 m!". The passenger's position comes from their own device and never leaves it: the distance is computed on the phone or in the browser. Because of that, the alert works while the app is open. Alerting with the app closed would require the server to know the passenger's location (a separate decision).

To test it in the browser:

1. Run the simulator: `npm run simulate:driver -- --start-trip` (laps of 500 m radius at ~40 km/h).
2. In Chrome DevTools, open Sensors > Location and set a custom location on the loop, for example `10.5061, -66.910032` (500 m east of the default center).
3. Log in as a passenger, tap "Usaré el transporte" and allow notifications. When the driver passes by, the border turns yellow and the notification appears.

The web map loads MapLibre's worker from `mobile/public/maplibre-gl-worker.mjs`. That file is copied there by `npm install` (postinstall) and is not committed.

## Internal test build (choose the API inside the app)

The `preview-debug` EAS profile builds an APK with `EXPO_PUBLIC_DEBUG_API=true`. That build shows a settings button at the top left of every screen (next to the company on the driver screen) where a tester types the API address, for example `192.168.1.20:3000` for a backend running on their machine. The address is remembered on the device, changing it signs the user out, and "Usar la dirección por defecto" goes back to the built-in `EXPO_PUBLIC_API_URL`.

```bash
cd mobile
npx eas-cli@latest build -p android --profile preview-debug
```

Only this build allows plain `http://` on Android (`mobile/app.config.js`); regular builds have neither the button nor cleartext traffic. It uses the same package id as the regular APK, so installing one replaces the other. The phone and the machine must be on the same network, and the backend must listen on all interfaces (it does by default, `HOST=0.0.0.0`).

## Admin panel

Open **http://localhost:3000/admin** to list, create, edit and delete passengers and drivers. You can also change roles and reset passwords. The panel is served by the API itself, with no build step.

- **Companies:** the "Empresas" section creates, renames and deletes companies and edits their routes (name, pickup or dropoff, and order of rotation). Each user is assigned one company (passengers) or several (drivers) in the user form, and the user list can be filtered by company. A company can only be deleted once it has no users and no route in progress.

- **Access:** a single master password, `ADMIN_PASSWORD` (12+ characters), set in `.env` next to `docker-compose.yml`. If it is unset or empty, the panel and its API do not exist (404).
- **Brute force:** 5 wrong attempts from one address lock that address out for 15 minutes.
- **Sessions:** admin sessions last 8 hours, are stored in the tab's `sessionStorage`, and are rejected by the app. App sessions are rejected by the panel.
- **The running trip is protected:** nobody in it can be deleted, change role or be taken out of that company, and its drivers cannot be deleted, demoted or removed from the company while the trip is running.
- **New users:** "Generar" creates a strong password, which is shown once (with a copy button) so you can hand it over.
- **Hardening:** the page sends a strict Content-Security-Policy and only ever renders user data as text.

## API

All routes except `/health` and `/auth/login` need `Authorization: Bearer <token>`. Every trip endpoint returns the role-specific state view of one company.

Trip endpoints accept `?companyId=<id>`. It is optional for users registered in a single company and required for drivers registered in several (`400 COMPANY_REQUIRED`). Naming a company the user is not registered in answers `403 FORBIDDEN`; a user without any company gets `409 NO_COMPANY`. `/me` and the login response list the user's `companies`.

| Method | Path | Who |
|---|---|---|
| POST | `/auth/login` | anyone |
| GET | `/me` | any user |
| PUT | `/me/push-token` `{ token: string \| null }` | any user |
| GET | `/trips/current` | any user |
| POST | `/trips` | driver: starts the next route in the company's rotation. `409 NO_ROUTES` if the company has none |
| POST | `/trips/current/passengers` | passenger: joins the active trip (idempotent) |
| DELETE | `/trips/current/passengers` | passenger: cancels their seat (idempotent). `409 STOP_ALREADY_CONFIRMED` once picked up |
| POST | `/trips/current/passengers/:userId/confirm` | driver |
| POST | `/trips/current/finish` | driver: only when every stop is confirmed |
| WS | `/ws/location` | auth first like `/ws`; the driver sends `{ type: "position", lat, lng, heading? }`, joined passengers receive `{ type: "driver-position", ... }` |
| POST | `/location` | driver: `{ lat, lng, heading? }` relayed like `/ws/location` (used by background tracking), only to the trip that driver started; `204`, or `409 NO_ACTIVE_TRIP` when they have none open |
| POST | `/admin/login` `{ password }` | admin: master password, returns an 8 h admin token (`429` after 5 failures) |
| GET / POST | `/admin/users` | admin: list / create (`{ name, email, address, role, password, companyIds }`) |
| PATCH / DELETE | `/admin/users/:id` | admin: edit any field (incl. `role`, `password`, `companyIds`) / delete. `409 USER_IN_ACTIVE_TRIP` while in the running trip |
| GET / POST | `/admin/companies` | admin: list / create (`{ name, routes: [{ name, kind: "pickup" \| "dropoff" }] }`, routes in rotation order) |
| PATCH / DELETE | `/admin/companies/:id` | admin: rename and/or replace the route list (keep a route's `id` to rename or move it) / delete. `409 COMPANY_HAS_MEMBERS`, `409 COMPANY_IN_ACTIVE_TRIP` |
| WS | `/ws` | send `{ "type": "auth", "token": "...", "companyId"?: "..." }` first. You then receive `{ type: "state", data }` on every change of that company. Closes with `4403` when the company is not available to the user |

Passengers never receive other passengers' names or addresses.

## Architecture (backend)

Hexagonal. `trips/` and `users/` hold the domain and use cases with no framework imports. Their ports (`TripRepository`, `TripEvents`, `TripNotifier`, `UserRepository`) are implemented in `infrastructure/`:

- **Postgres:** production.
- **In-memory:** tests.
- **Expo push:** notifications.
- **WebSocket hub:** realtime.

The database enforces the invariants even under concurrent requests:

- A partial unique index allows only one active trip.
- Row locks prevent a passenger from joining while the trip is being finished.
