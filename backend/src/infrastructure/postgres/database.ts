import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

export type Sql = postgres.Sql;

export function connect(url: string): Sql {
  return postgres(url, { max: 10, onnotice: () => {} });
}

export async function migrate(sql: Sql): Promise<void> {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await sql.unsafe(schema);
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    error instanceof postgres.PostgresError && error.code === '23505' && error.constraint_name === constraint
  );
}
