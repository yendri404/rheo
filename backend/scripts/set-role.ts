// Usage: npm run user:set-role -- --email ana@example.com --role driver
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { connect } from '../src/infrastructure/postgres/database.ts';
import { PostgresUserRepository } from '../src/infrastructure/postgres/postgres-user-repository.ts';

const { email, role } = z
  .object({ email: z.string().trim().min(1), role: z.enum(['driver', 'passenger']) })
  .parse(parseArgs({ options: { email: { type: 'string' }, role: { type: 'string' } } }).values);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const sql = connect(databaseUrl);
try {
  if (!(await new PostgresUserRepository(sql).setRole(email, role))) {
    console.error(`No user with email ${email}`);
    process.exitCode = 1;
  } else {
    console.log(`${email} is now a ${role}. The app switches screens the next time it is opened.`);
  }
} finally {
  await sql.end();
}
