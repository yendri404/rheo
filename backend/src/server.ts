import { loadConfig } from './config.ts';
import { buildApp } from './http/app.ts';
import { ExpoPushNotifier } from './infrastructure/expo/expo-push-notifier.ts';
import { connect, migrate } from './infrastructure/postgres/database.ts';
import { PostgresTripRepository } from './infrastructure/postgres/postgres-trip-repository.ts';
import { PostgresUserRepository } from './infrastructure/postgres/postgres-user-repository.ts';
import { WsHub } from './infrastructure/realtime/ws-hub.ts';
import { TripService } from './trips/trip-service.ts';
import { AuthService } from './users/auth-service.ts';

const config = loadConfig();
const sql = connect(config.DATABASE_URL);
await migrate(sql);

const users = new PostgresUserRepository(sql);
const hub = new WsHub();
hub.startHeartbeat();

const app = await buildApp({
  users,
  hub,
  authService: new AuthService(users),
  jwtSecret: config.JWT_SECRET,
  adminPassword: config.ADMIN_PASSWORD,
  trustProxy: config.TRUST_PROXY,
  logger: true,
  tripService: new TripService({
    trips: new PostgresTripRepository(sql),
    users,
    events: hub,
    notifier: new ExpoPushNotifier({ accessToken: config.EXPO_ACCESS_TOKEN }),
    onBackgroundError: (error) => app.log.error({ err: error }, 'Push notification failed'),
  }),
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}

await app.listen({ port: config.PORT, host: config.HOST });
