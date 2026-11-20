import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import type { WsHub } from '../infrastructure/realtime/ws-hub.ts';
import { registerAdminRoutes } from '../admin/admin-routes.ts';
import { AdminService } from '../admin/admin-service.ts';
import { registerLocationRoutes } from '../location/location-relay.ts';
import { AppError, type ErrorCode } from '../shared/app-error.ts';
import type { TripService } from '../trips/trip-service.ts';
import { viewFor } from '../trips/views.ts';
import type { AuthService } from '../users/auth-service.ts';
import type { User, UserRepository } from '../users/user.ts';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    /** `scope: 'admin'` marks admin-panel sessions, which the app routes reject. */
    payload: { sub: string; scope?: 'admin' };
  }
}

export type AppDependencies = {
  users: UserRepository;
  hub: WsHub;
  tripService: TripService;
  authService: AuthService;
  jwtSecret: string;
  tokenTtl?: string;
  logger?: boolean;
  /** Master password for the admin panel. When unset, the panel and its API do not exist. */
  adminPassword?: string;
};

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  EMAIL_TAKEN: 409,
  FORBIDDEN: 403,
  PASSENGER_NOT_IN_TRIP: 404,
  TRIP_ALREADY_ACTIVE: 409,
  NO_ACTIVE_TRIP: 409,
  PENDING_STOPS: 409,
  STOP_ALREADY_CONFIRMED: 409,
  VALIDATION_FAILED: 400,
  USER_NOT_FOUND: 404,
  USER_IN_ACTIVE_TRIP: 409,
  TOO_MANY_ATTEMPTS: 429,
};

const WS_AUTH_TIMEOUT_MS = 5_000;
const WS_UNAUTHORIZED = 4401;

const emailField = z.string().trim().toLowerCase().pipe(z.email().max(254));
const loginBody = z.object({ email: emailField, password: z.string().min(1).max(200) });
const pushTokenBody = z.object({ token: z.string().min(1).max(300).nullable() });
const passengerParams = z.object({ userId: z.uuid() });
const wsAuthMessage = z.object({ type: z.literal('auth'), token: z.string() });

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const { users, hub, tripService, authService } = deps;
  const app = Fastify({ logger: deps.logger ?? false });

  // @fastify/cors only allows GET/HEAD/POST by default; browsers would block PUT and DELETE preflights.
  await app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'] });
  await app.register(jwt, { secret: deps.jwtSecret, sign: { expiresIn: deps.tokenTtl ?? '30d' } });
  await app.register(websocket, { options: { maxPayload: 4096 } });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(STATUS_BY_CODE[error.code]).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION_FAILED', message: z.prettifyError(error) } });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: { code: 'VALIDATION_FAILED', message: (error as Error).message } });
    }
    request.log.error(error);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Unexpected error.' } });
  });

  async function userFromToken(token: string): Promise<User> {
    let payload: { sub: string; scope?: 'admin' };
    try {
      payload = app.jwt.verify<{ sub: string; scope?: 'admin' }>(token);
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Invalid or expired session.');
    }
    // Admin-panel sessions are not app users (and their `sub` is not a user id).
    if (payload.scope === 'admin') throw new AppError('UNAUTHENTICATED', 'Invalid or expired session.');
    const user = await users.findById(payload.sub);
    if (!user) throw new AppError('UNAUTHENTICATED', 'Invalid or expired session.');
    return user;
  }

  async function currentUser(request: FastifyRequest): Promise<User> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AppError('UNAUTHENTICATED', 'Missing session.');
    return userFromToken(header.slice('Bearer '.length));
  }

  app.get('/health', async () => ({ ok: true }));

  app.post('/auth/login', async (request) => {
    const { email, password } = loginBody.parse(request.body);
    const user = await authService.login(email, password);
    return { token: app.jwt.sign({ sub: user.id }), user };
  });

  // No self sign-up: the app is private, users are created by an administrator
  // (for now with scripts/create-user.ts; later from a web panel).
  app.get('/me', async (request) => currentUser(request));

  app.put('/me/push-token', async (request, reply) => {
    const user = await currentUser(request);
    const { token } = pushTokenBody.parse(request.body);
    await users.setPushToken(user.id, token);
    return reply.status(204).send();
  });

  app.get('/trips/current', async (request) => {
    const user = await currentUser(request);
    return viewFor(await tripService.state(), user);
  });

  app.post('/trips', async (request, reply) => {
    const user = await currentUser(request);
    return reply.status(201).send(viewFor(await tripService.start(user), user));
  });

  app.post('/trips/current/passengers', async (request) => {
    const user = await currentUser(request);
    return viewFor(await tripService.join(user), user);
  });

  app.delete('/trips/current/passengers', async (request) => {
    const user = await currentUser(request);
    return viewFor(await tripService.leave(user), user);
  });

  app.post('/trips/current/passengers/:userId/confirm', async (request) => {
    const user = await currentUser(request);
    const { userId } = passengerParams.parse(request.params);
    return viewFor(await tripService.confirmStop(user, userId), user);
  });

  app.post('/trips/current/finish', async (request) => {
    const user = await currentUser(request);
    return viewFor(await tripService.finish(user), user);
  });

  // The token travels in the first message, not the URL, so it never lands in access logs.
  app.get('/ws', { websocket: true }, (socket) => {
    const timeout = setTimeout(() => socket.close(WS_UNAUTHORIZED, 'Authentication timeout'), WS_AUTH_TIMEOUT_MS);
    socket.once('message', async (raw) => {
      clearTimeout(timeout);
      try {
        const { token } = wsAuthMessage.parse(JSON.parse(raw.toString()));
        const user = await userFromToken(token);
        hub.add(socket, user, await tripService.state());
      } catch {
        socket.close(WS_UNAUTHORIZED, 'Unauthorized');
      }
    });
    socket.once('close', () => clearTimeout(timeout));
  });

  registerLocationRoutes(app, { authenticate: userFromToken, tripService });

  if (deps.adminPassword) {
    registerAdminRoutes(app, { adminPassword: deps.adminPassword, adminService: new AdminService(users, tripService) });
  }

  app.addHook('onClose', async () => hub.close());

  return app;
}
