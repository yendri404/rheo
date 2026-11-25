import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../shared/app-error.ts';
import type { AdminService } from './admin-service.ts';
import { LoginThrottle } from './login-throttle.ts';

const ADMIN_TOKEN_TTL = '8h';

const name = z.string().trim().min(1).max(100);
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const address = z.string().trim().max(300);
const role = z.enum(['driver', 'passenger']);
const password = z.string().min(8).max(200);

const loginBody = z.object({ password: z.string().min(1).max(200) });
const companyIds = z.array(z.uuid()).max(50);
const createBody = z.object({ name, email, address: address.default(''), role, password, companyIds });
const updateBody = z
  .object({ name, email, address, role, password, companyIds })
  .partial()
  .refine((changes) => Object.keys(changes).length > 0, 'Nothing to update');
const idParams = z.object({ id: z.uuid() });

// Route names are short on purpose: the app shows them in a large banner on a phone screen.
const route = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(24),
  kind: z.enum(['pickup', 'dropoff']),
});
const routes = z
  .array(route)
  .max(20)
  .refine(
    (list) => new Set(list.map((item) => item.name.toLowerCase())).size === list.length,
    'Route names must be unique within a company',
  );
const companyName = z.string().trim().min(1).max(60);
const createCompanyBody = z.object({ name: companyName, routes: routes.default([]) });
const updateCompanyBody = z
  .object({ name: companyName, routes })
  .partial()
  .refine((changes) => Object.keys(changes).length > 0, 'Nothing to update');

// The page is static and self-contained: everything is served from this origin except Google Fonts.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const ASSETS = {
  '/admin': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/admin/admin.js': { file: 'admin.js', type: 'text/javascript; charset=utf-8' },
  '/admin/admin.css': { file: 'admin.css', type: 'text/css; charset=utf-8' },
} as const;

function sameSecret(given: string, expected: string): boolean {
  // Hash first so the comparison is constant-time regardless of length.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Admin panel: a static page at /admin plus a JSON API under /admin/*.
 * Access is a single master password (ADMIN_PASSWORD). Admin sessions are separate JWTs
 * (scope "admin", 8h) that the app rejects, and app sessions are rejected here.
 */
export function registerAdminRoutes(
  app: FastifyInstance,
  deps: { adminPassword: string; adminService: AdminService; throttle?: LoginThrottle },
): void {
  const throttle = deps.throttle ?? new LoginThrottle();
  const { adminService } = deps;

  for (const [url, asset] of Object.entries(ASSETS)) {
    const body = readFileSync(new URL(`../../admin/${asset.file}`, import.meta.url));
    app.get(url, async (_request, reply) =>
      reply
        .header('content-type', asset.type)
        .header('content-security-policy', CONTENT_SECURITY_POLICY)
        .header('x-content-type-options', 'nosniff')
        .header('referrer-policy', 'no-referrer')
        .header('cache-control', 'no-store')
        .send(body),
    );
  }

  async function requireAdmin(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AppError('UNAUTHENTICATED', 'Missing admin session.');
    let payload: { sub: string; scope?: string };
    try {
      payload = app.jwt.verify<{ sub: string; scope?: string }>(header.slice('Bearer '.length));
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Invalid or expired admin session.');
    }
    if (payload.scope !== 'admin') throw new AppError('UNAUTHENTICATED', 'Not an admin session.');
  }

  app.post('/admin/login', async (request) => {
    const key = request.ip;
    if (throttle.isLocked(key)) {
      throw new AppError('TOO_MANY_ATTEMPTS', 'Too many failed attempts. Try again in a few minutes.');
    }
    const { password: given } = loginBody.parse(request.body);
    if (!sameSecret(given, deps.adminPassword)) {
      throttle.recordFailure(key);
      throw new AppError('INVALID_CREDENTIALS', 'Invalid password.');
    }
    throttle.recordSuccess(key);
    return { token: app.jwt.sign({ sub: 'admin', scope: 'admin' }, { expiresIn: ADMIN_TOKEN_TTL }) };
  });

  app.get('/admin/users', async (request) => {
    await requireAdmin(request);
    return { users: await adminService.list() };
  });

  app.post('/admin/users', async (request, reply: FastifyReply) => {
    await requireAdmin(request);
    return reply.status(201).send({ user: await adminService.create(createBody.parse(request.body)) });
  });

  app.patch('/admin/users/:id', async (request) => {
    await requireAdmin(request);
    const { id } = idParams.parse(request.params);
    return { user: await adminService.update(id, updateBody.parse(request.body)) };
  });

  app.delete('/admin/users/:id', async (request, reply) => {
    await requireAdmin(request);
    const { id } = idParams.parse(request.params);
    await adminService.delete(id);
    return reply.status(204).send();
  });

  app.get('/admin/companies', async (request) => {
    await requireAdmin(request);
    return { companies: await adminService.listCompanies() };
  });

  app.post('/admin/companies', async (request, reply) => {
    await requireAdmin(request);
    return reply.status(201).send({ company: await adminService.createCompany(createCompanyBody.parse(request.body)) });
  });

  app.patch('/admin/companies/:id', async (request) => {
    await requireAdmin(request);
    const { id } = idParams.parse(request.params);
    return { company: await adminService.updateCompany(id, updateCompanyBody.parse(request.body)) };
  });

  app.delete('/admin/companies/:id', async (request, reply) => {
    await requireAdmin(request);
    const { id } = idParams.parse(request.params);
    await adminService.deleteCompany(id);
    return reply.status(204).send();
  });
}
