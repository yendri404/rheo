import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  // Set to "true" when the API sits behind a reverse proxy (Caddy, nginx, a PaaS router) so
  // request.ip is the real client and the login throttle does not lock everyone out together.
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  // Admin panel master password. Empty or unset disables the panel entirely.
  ADMIN_PASSWORD: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined))
    .refine((value) => value === undefined || value.length >= 12, 'ADMIN_PASSWORD must be at least 12 characters'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
