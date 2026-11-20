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

Passengers sign up from the app ("Crear cuenta"). Sign-up **always** creates a passenger. Drivers are assigned manually:

```bash
# Promote an existing account (the app switches to driver screens the next time it opens)
docker compose exec api node scripts/set-role.ts --email ana@example.com --role driver

# Or create any user directly
docker compose exec api node scripts/create-user.ts \
  --email ana@example.com --password 'min-8-chars' --name "Ana" --address "Calle 1 #23" --role driver
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

The web map loads MapLibre's worker from `mobile/public/maplibre-gl-worker.mjs`. That file is copied there by `npm install` (postinstall) and is not committed.

## API

All routes except `/health`, `/auth/register` and `/auth/login` need `Authorization: Bearer <token>`. Every trip endpoint returns the role-specific state view.

| Method | Path | Who |
|---|---|---|
| POST | `/auth/register` `{ name, email, password (8+), address }` | anyone: always creates a passenger, `409 EMAIL_TAKEN` on duplicates |
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
