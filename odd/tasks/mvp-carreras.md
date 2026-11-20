# MVP carreras

Objective: driver/passenger transport app (React Native + backend) with realtime trip management and route rotation.
Branch: `feat/mvp-carreras` · Delivery: ask-on-risk · Test runner: vitest (backend), `tsc --noEmit` (mobile).

## Specs

- **S1** Stack: "vamos a crear una app en react native, y con un backend a tu desicion que sea facil de mantener y de desplegar". Decision: Expo (React Native) app; Node + TypeScript + Fastify + PostgreSQL backend, shipped with Docker Compose.
- **S2** Out of scope for now: "de momento lo dejaremos sin nada que tenga que ver con filtrado y apis" (no route ordering, no maps APIs).
- **S3** "chofer debe ser capaz de iniciar una carrera y eso habilitara la app para los demas usuarios"
- **S4** "ellos podran marcar que haran uso del transporte y se reflejara en tiempo real en la app del chofer, donde saldra en una lista el nombre del pasajero y su direccion"
- **S5** "en esa \"fila\" tendra un boton para confirmar la parada de cada pasajero"
- **S6** "una vez todos los pasajeros hayan sido \"confirmados\" el boton de abajo en la ruta podra seleccionar como ruta finalizada y deberia devolverlo al menu de empezar ruta"
- **S7** "teniendo 3 rutas diferentes, mañana, norte, sur siendo que cada que inicie una ruta se iran rotando entre turnos" — rotation order Mañana → Norte → Sur → Mañana.
- **S8** "al usar el boton de empezar ruta todos los usaurios reciben una notificacion y el usuario puede optar por usar esa ruta o ignorarla por completo" — push via Expo Push Service.
- **S9** "las necesidades tecnicas son la eficiencia en el backend pero ser agradable de usar en las apps"
- **S10** UI follows `Main UI.svg`: login (email + password), passenger view ("Proxima Ruta", "Usare el transporte" → "Confirmado"), driver views ("Siguiente Ruta" + "Empezar nueva Carrera", trip list "Ruta: X" with per-row confirm + "Terminar Ruta", "Carrera finalizada" + "Ok"). Palette: primary #2D8665, dark #22393A, background #EAF0F1, disabled #A7BCBE, accent #FFC105; font Comfortaa.
- ~~Assumption A1: no self sign-up~~ superseded by S11.
- **S11** "agrega soporte web junto con la capacidad de registrar usuarios, el usuario chofer lo designaremos manualmente (de momento)". Self sign-up always creates a passenger (name, email, password 8+, address). Drivers are assigned with `scripts/set-role.ts`.
- **S12** Web support: the app runs in a browser (Expo web) to allow testing without an Android device.
- **S13** "agregues un boton para cancelarlo pero mas pequeño en la vista de pasajero". A small "Ya no lo usaré" button. Not allowed once the driver confirmed the stop (server-enforced, `STOP_ALREADY_CONFIRMED`).
- **S14** "preguntas y verificaciones a cualquier accion importante del chofer como empezar o terminar carrera". Confirmation dialogs for start, confirm stop, finish (with summary), and sign-out.
- **S15** "en la vista del chofer haz que siempre tenga el tache para mostrar que ya esta listo ese empleado y que se ponga en gris los que ya estan listo para que no distraiga la atencion". The check is always shown on the row action. Confirmed rows are greyed out. Assumption: "tache" means the check mark.
- **S16** "el bloque \"background\" verde sera el fondo total de la app, y en el esapacio restante solo habran mensajes cortos, mientras que el recuardo de mas abajo sera escroleable para que tome el resto de espacio en pantalla dando ese efecto 3d muy sencillo".
- Assumption A2: one app for both roles; the screen set depends on the logged-in user's role.
- Assumption A3: finishing with zero passengers is allowed ("all confirmed" is vacuously true).

## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 | S1,S3-S7 | inline | done | 95f81c5, 4c9d41a: RED observed, 26 tests green |
| T2 | S8 | inline | done | cb08d6f: notifier tests green; real delivery needs EAS project + device (pending) |
| T3 | S1,S9 | inline | done | cb08d6f: contract tests green on Postgres 17; docker compose smoke test passed |
| T4 | S1,S3-S6,S8,S10 | inline | done | tsc clean, expo-doctor 20/20, Android bundle exported; not yet run on a device (pending) |
| T5 | S11 | inline | done | d3dc214: RED observed (9 tests); 58 tests green incl. Postgres contract |
| T6 | S11,S12 | inline | done | web e2e in headless Chrome, 7/7 steps, no page errors |
| T7 | S13 | inline | done | 113b428: RED observed (7 tests); ea55afb: CORS fix found by e2e (RED 2 tests); 70 tests green |
| T8 | S13-S15 | inline | done | 15e8228: isolated web e2e 8/8 steps, no page errors |
| T9 | S16 | inline | done | 22685ed: layout e2e (header opacity 0.85 -> 0 on scroll, footer pinned) + regression 8/8 |

## Log

- **L1** (2026-11-19) User request: "vamos a crear una app en react native, y con un backend a tu desicion que sea facil de mantener y de desplegar  que permita a un chofer gestionar un transporte, de momento lo dejaremos sin nada que tenga que ver con filtrado y apis, primero, chofer debe ser capaz de iniciar una carrera y eso habilitara la app para los demas usuarios, ellos podran marcar que haran uso del transporte y se reflejara en tiempo real en la app del chofer, donde saldra en una lista el nombre del pasajero y su direccion, en esa \"fila\" tendra un boton para confirmar la parada de cada pasajero, una vez todos los pasajeros hayan sido \"confirmados\" el boton de abajo en la ruta podra seleccionar como ruta finalizada y deberia devolverlo al menu de empezar ruta, teniendo 3 rutas diferentes, mañana, norte, sur siendo que cada que inicie una ruta se iran rotando entre turnos, al usar el boton de empezar ruta todos los usaurios reciben una notificacion y el usuario puede optar por usar esa ruta o ignorarla por completo. te deje en el repositorio un SVG con el mockup de la interfaz para que tengas con que trabjar como base. las necesidades tecnicas son la eficiencia en el backend pero ser agradable de usar en las apps que soliciten usarlo buena suerte"
- **L2** Mockup rendered and read: 4 driver screens, 2 passenger screens, 1 login screen.
- **L3** (2026-11-19) Power outage mid-T1. Four files (ws-hub, views, auth-service, password) were on disk from the interrupted turn without a transcript; they were reviewed after commit 95f81c5, match the design, and were kept.
- **L4** Backend verified: 47 tests (in-memory + Postgres contract, including concurrent start and join-vs-finish races). The end-to-end smoke test against docker compose passed: start → join pushed over WS → finish blocked (PENDING_STOPS) → confirm → finish → next route norte.
- **L5** Mobile: Expo SDK 58, Expo Router (per template AGENTS.md). UI copy is in neutral Spanish, matching the mockup. Push needs `eas init` plus a dev build (Expo Go on Android has no remote push). `.env.example` is blocked by local permissions, so the env vars are documented in README instead.
- **L6** (2026-11-19) User: "este proyecto es completamente diferente al del repositorio survey-app. a partir de ahora ten eso en ecuenta". Engram is scoped to `proyecto-carreras`.
- **L7** (2026-11-19) User request: "sí, agrega soporte web junto con la capacidad de registrar usuarios, el usuario chofer lo designaremos manualmente (de momento)".
- **L8** Web: platform files (`secure-storage.web.ts` uses localStorage, `push.web.ts` is a no-op). Alert.alert was replaced with inline errors because Alert is a no-op on web. `/me` refresh picks up role changes without re-login. E2E: driver login → passenger sign-up → live start → live join → confirm → finish → rotate to Norte → set-role promotion. All verified in two browser contexts against docker compose.
- **L9** (2026-11-19) User request: "ya entre, hiciste un gran trabajo, pero necesito que agregues un boton para cancelarlo pero mas pequeño en la vista de pasajero, y preguntas y verificaciones a cualquier accion importante del chofer como empezar o terminar carrera, en la vista del chofer haz que siempre tenga el tache para mostrar que ya esta listo ese empleado y que se ponga en gris los que ya estan listo para que no distraiga la atencion"
- **L10** E2E found a latent bug: @fastify/cors only allows GET/HEAD/POST by default, so web DELETE (and PUT /me/push-token) were blocked. Native apps were unaffected. Fixed and pinned with a preflight test. The live deploy was rebuilt reusing the container's JWT secret, so sessions were kept.
- **L11** (2026-11-20) S16 implemented in ScreenLayout: green root, absolute header that recedes (opacity, scale, drift) on scroll, sheet with minHeight = viewport - top bar so it can always cover the header, primary action pinned. FlatList was replaced by map inside the scrolling sheet (few passengers per route).
- **Next:** run on devices; rate-limit `/auth/register` and `/auth/login` before public exposure; route ordering (S2 deferred).
