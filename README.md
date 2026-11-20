# Proyecto Carreras

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
# Create a passenger (or --role driver)
docker compose exec api node scripts/create-user.ts \
  --email ana@example.com --password 'min-8-chars' --name "Ana" --address "Calle 1 #23" --role passenger

# Change an existing account's role (the app switches screens the next time it opens)
docker compose exec api node scripts/set-role.ts --email ana@example.com --role driver
```

The schema is applied automatically on every boot (`backend/src/infrastructure/postgres/schema.sql`).

### Develop and test

```bash
cd backend
npm install
npm test           # domain, HTTP, realtime and in-memory contract tests
npm run typecheck

# Also run the repository contract against a real Postgres:
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

Passengers who joined the active trip see the driver as a pin on a map. The driver's position is relayed over `WS /ws/location` and is never stored: it lives only in memory, and only while a trip is active. The map currently runs on **web** (MapLibre + free OpenFreeMap tiles, no API key). On phones, a placeholder is shown until the native map (which needs a development build) is added.

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

## Admin panel

Open **http://localhost:3000/admin** to list, create, edit and delete passengers and drivers. You can also change roles and reset passwords. The panel is served by the API itself, with no build step.

- **Access:** a single master password, `ADMIN_PASSWORD` (12+ characters), set in `.env` next to `docker-compose.yml`. If it is unset or empty, the panel and its API do not exist (404).
- **Brute force:** 5 wrong attempts from one address lock that address out for 15 minutes.
- **Sessions:** admin sessions last 8 hours, are stored in the tab's `sessionStorage`, and are rejected by the app. App sessions are rejected by the panel.
- **The running trip is protected:** nobody in it can be deleted or change role, and drivers cannot be deleted or demoted while a trip is running.
- **New users:** "Generar" creates a strong password, which is shown once (with a copy button) so you can hand it over.
- **Hardening:** the page sends a strict Content-Security-Policy and only ever renders user data as text.

## API

All routes except `/health` and `/auth/login` need `Authorization: Bearer <token>`. Every trip endpoint returns the role-specific state view.

| Method | Path | Who |
|---|---|---|
| POST | `/auth/login` | anyone |
| GET | `/me` | any user |
| PUT | `/me/push-token` `{ token: string \| null }` | any user |
| GET | `/trips/current` | any user |
| POST | `/trips` | driver: starts the next route in the rotation |
| POST | `/trips/current/passengers` | passenger: joins the active trip (idempotent) |
| DELETE | `/trips/current/passengers` | passenger: cancels their seat (idempotent). `409 STOP_ALREADY_CONFIRMED` once picked up |
| POST | `/trips/current/passengers/:userId/confirm` | driver |
| POST | `/trips/current/finish` | driver: only when every stop is confirmed |
| WS | `/ws/location` | auth first like `/ws`; the driver sends `{ type: "position", lat, lng, heading? }`, joined passengers receive `{ type: "driver-position", ... }` |
| POST | `/admin/login` `{ password }` | admin: master password, returns an 8 h admin token (`429` after 5 failures) |
| GET / POST | `/admin/users` | admin: list / create (`{ name, email, address, role, password }`) |
| PATCH / DELETE | `/admin/users/:id` | admin: edit any field (incl. `role`, `password`) / delete. `409 USER_IN_ACTIVE_TRIP` while in the running trip |
| WS | `/ws` | send `{ "type": "auth", "token": "..." }` first. You then receive `{ type: "state", data }` on every change |

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
