// Usage: npm run user:create -- --email ana@example.com --password secret123 --name "Ana" --address "Calle 1" --role passenger --company Eureka
// Repeat --company for a driver who works for several companies. Companies are created from the admin panel.
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { connect, migrate } from '../src/infrastructure/postgres/database.ts';
import { PostgresCompanyRepository } from '../src/infrastructure/postgres/postgres-company-repository.ts';
import { PostgresUserRepository } from '../src/infrastructure/postgres/postgres-user-repository.ts';
import { hashPassword } from '../src/users/password.ts';

const input = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(8, 'password must be at least 8 characters'),
    name: z.string().trim().min(1),
    address: z.string().trim().default(''),
    role: z.enum(['driver', 'passenger']),
    company: z.array(z.string().trim().min(1)).min(1, 'at least one --company is required'),
  })
  .refine((value) => value.role === 'driver' || value.company.length === 1, 'a passenger belongs to exactly one company')
  .parse(
    parseArgs({
      options: {
        email: { type: 'string' },
        password: { type: 'string' },
        name: { type: 'string' },
        address: { type: 'string' },
        role: { type: 'string' },
        company: { type: 'string', multiple: true },
      },
    }).values,
  );

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const sql = connect(databaseUrl);
try {
  await migrate(sql);
  const { password, company: companyNames, ...rest } = input;
  const companies = await new PostgresCompanyRepository(sql).list();
  const companyIds = companyNames.map((name) => {
    const found = companies.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (!found) throw new Error(`No company named "${name}". Existing: ${companies.map((c) => c.name).join(', ') || 'none'}`);
    return found.id;
  });
  const user = await new PostgresUserRepository(sql).create({ ...rest, companyIds, passwordHash: await hashPassword(password) });
  console.log(`Created ${user.role} ${user.email} (${user.id})`);
} finally {
  await sql.end();
}
