// Usage: npm run user:create -- --email ana@example.com --password secret123 --name "Ana" --address "Calle 1" --role passenger
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { connect, migrate } from '../src/infrastructure/postgres/database.ts';
import { PostgresUserRepository } from '../src/infrastructure/postgres/postgres-user-repository.ts';
import { hashPassword } from '../src/users/password.ts';

const input = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(8, 'password must be at least 8 characters'),
    name: z.string().trim().min(1),
    address: z.string().trim().default(''),
    role: z.enum(['driver', 'passenger']),
  })
  .parse(
    parseArgs({
      options: {
        email: { type: 'string' },
        password: { type: 'string' },
        name: { type: 'string' },
        address: { type: 'string' },
        role: { type: 'string' },
      },
    }).values,
  );

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const sql = connect(databaseUrl);
try {
  await migrate(sql);
  const { password, ...rest } = input;
  const user = await new PostgresUserRepository(sql).create({ ...rest, passwordHash: await hashPassword(password) });
  console.log(`Created ${user.role} ${user.email} (${user.id})`);
} finally {
  await sql.end();
}
