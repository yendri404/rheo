// Development data only. Creates a driver and four passengers, all with password "carreras123".
import { connect, migrate } from '../src/infrastructure/postgres/database.ts';
import { PostgresUserRepository } from '../src/infrastructure/postgres/postgres-user-repository.ts';
import type { NewUser } from '../src/users/user.ts';
import { hashPassword } from '../src/users/password.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const sql = connect(databaseUrl);
try {
  await migrate(sql);
  const users = new PostgresUserRepository(sql);
  const passwordHash = await hashPassword('carreras123');
  const seed: Omit<NewUser, 'passwordHash'>[] = [
    { email: 'chofer@carreras.dev', name: 'Chofer', address: '', role: 'driver' },
    { email: 'usuario1@carreras.dev', name: 'Usuario 1', address: 'Av. Principal 101', role: 'passenger' },
    { email: 'usuario2@carreras.dev', name: 'Usuario 2', address: 'Calle 2 #45', role: 'passenger' },
    { email: 'usuario3@carreras.dev', name: 'Usuario 3', address: 'Calle 3 #12', role: 'passenger' },
    { email: 'usuario4@carreras.dev', name: 'Usuario 4', address: 'Calle 4 #78', role: 'passenger' },
  ];
  for (const user of seed) {
    if (await users.findByEmail(user.email)) continue;
    await users.create({ ...user, passwordHash });
    console.log(`Created ${user.role} ${user.email}`);
  }
} finally {
  await sql.end();
}
