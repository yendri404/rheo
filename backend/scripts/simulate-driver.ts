// Simulated driver for testing the live map without driving.
// Logs in as a driver and sends GPS positions over /ws/location, driving laps around a center point.
//
// Usage (from backend/):
//   npm run simulate:driver -- --start-trip
//   npm run simulate:driver -- --lat 10.5061 --lng -66.9146 --radius 600 --lap 90 --interval 2000
//
// To test the "driver is near" alert in the browser, set the passenger's location (Chrome DevTools >
// Sensors > Location) to a point on the loop, e.g. 10.5061, -66.910032 (500 m east of the default center).
//
// Options:
//   --api         API base URL                     (default http://localhost:3000)
//   --email       driver email                     (default chofer@carreras.dev)
//   --password    driver password                  (default carreras123)
//   --lat --lng   center of the loop               (default 10.5061, -66.9146)
//   --radius      loop radius in meters            (default 500)
//   --lap         seconds per lap                  (default 280: ~40 km/h on a 500 m radius, a realistic city speed;
//                 use e.g. --lap 60 to see laps faster)
//   --interval    ms between positions             (default 2000, like a real phone)
//   --start-trip  start a trip first if none is active
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://localhost:3000' },
    email: { type: 'string', default: 'chofer@carreras.dev' },
    password: { type: 'string', default: 'carreras123' },
    lat: { type: 'string', default: '10.5061' },
    lng: { type: 'string', default: '-66.9146' },
    radius: { type: 'string', default: '500' },
    lap: { type: 'string', default: '280' },
    interval: { type: 'string', default: '2000' },
    'start-trip': { type: 'boolean', default: false },
  },
});

const api = values.api.replace(/\/$/, '');
const center = { lat: Number(values.lat), lng: Number(values.lng) };
const radius = Number(values.radius);
const lapMs = Number(values.lap) * 1000;
const intervalMs = Number(values.interval);
const METERS_PER_DEGREE = 111_320;

async function request(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const response = await fetch(`${api}${path}`, {
    ...rest,
    // Only declare JSON when there is a body: Fastify rejects an empty body with content-type JSON.
    headers: {
      ...(rest.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

/** Point on a circle around the center, with the heading of travel (degrees, 0 = north). */
function pointAt(fraction: number) {
  const angle = fraction * 2 * Math.PI;
  const lat = center.lat + (radius * Math.cos(angle)) / METERS_PER_DEGREE;
  const lng = center.lng + (radius * Math.sin(angle)) / (METERS_PER_DEGREE * Math.cos((center.lat * Math.PI) / 180));
  const heading = ((angle * 180) / Math.PI + 90) % 360; // tangent of a clockwise circle
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), heading: Math.round(heading) };
}

const login = await request('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: values.email, password: values.password }),
});
if (login.status !== 200) throw new Error(`Login failed (${login.status}): ${JSON.stringify(login.body)}`);
if (login.body.user.role !== 'driver') throw new Error(`${values.email} is not a driver`);
const token: string = login.body.token;
console.log(`Logged in as ${login.body.user.name}`);

if (values['start-trip']) {
  const started = await request('/trips', { method: 'POST', token });
  if (started.status === 201) console.log(`Trip started: ${started.body.activeTrip.route}`);
  else if (started.body?.error?.code === 'TRIP_ALREADY_ACTIVE') console.log('A trip is already active; reusing it');
  else throw new Error(`Could not start a trip (${started.status}): ${JSON.stringify(started.body)}`);
}

const startedAt = Date.now();
let sent = 0;

function connect(): void {
  const socket = new WebSocket(`${api.replace(/^http/, 'ws')}/ws/location`);
  let timer: ReturnType<typeof setInterval> | undefined;

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'auth', token }));
    const kmh = Math.round(((2 * Math.PI * radius) / (lapMs / 1000)) * 3.6);
    console.log(`Driving laps of ${radius}m around ${center.lat}, ${center.lng} (${lapMs / 1000}s per lap, ~${kmh} km/h). Ctrl+C to stop.`);
    timer = setInterval(() => {
      const fraction = ((Date.now() - startedAt) % lapMs) / lapMs;
      const position = pointAt(fraction);
      socket.send(JSON.stringify({ type: 'position', ...position }));
      sent += 1;
      if (sent % 10 === 1) console.log(`#${sent} lat=${position.lat} lng=${position.lng} heading=${position.heading}`);
    }, intervalMs);
  });

  socket.addEventListener('close', (event) => {
    clearInterval(timer);
    if (event.code === 4401) throw new Error('Location socket rejected the session');
    console.log('Connection lost, retrying in 2s…');
    setTimeout(connect, 2000);
  });
}

connect();
