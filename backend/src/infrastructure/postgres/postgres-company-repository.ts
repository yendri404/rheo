import {
  companyNameTaken,
  type CompanyChanges,
  type CompanyRepository,
  type CompanyWithRoutes,
  type Route,
  type RouteInput,
} from '../../companies/company.ts';
import { isUniqueViolation, type Queryable, type Sql } from './database.ts';

type CompanyRow = { id: string; name: string; routes: Route[] };

export class PostgresCompanyRepository implements CompanyRepository {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  list(): Promise<CompanyWithRoutes[]> {
    return select(this.#sql, null);
  }

  async findById(id: string): Promise<CompanyWithRoutes | null> {
    return (await select(this.#sql, id))[0] ?? null;
  }

  async create(name: string, routes: RouteInput[]): Promise<CompanyWithRoutes> {
    try {
      return await this.#sql.begin(async (tx) => {
        const [row] = await tx<{ id: string }[]>`INSERT INTO companies (name) VALUES (${name}) RETURNING id`;
        await replaceRoutes(tx, row!.id, routes);
        return (await select(tx, row!.id))[0]!;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'companies_name_key')) throw companyNameTaken();
      throw error;
    }
  }

  async update(id: string, changes: CompanyChanges): Promise<CompanyWithRoutes | null> {
    try {
      return await this.#sql.begin(async (tx) => {
        // Locks the company so two concurrent route edits cannot interleave.
        const [existing] = await tx`SELECT 1 FROM companies WHERE id = ${id} FOR UPDATE`;
        if (!existing) return null;
        if (changes.name !== undefined) await tx`UPDATE companies SET name = ${changes.name} WHERE id = ${id}`;
        if (changes.routes !== undefined) await replaceRoutes(tx, id, changes.routes);
        return (await select(tx, id))[0] ?? null;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'companies_name_key')) throw companyNameTaken();
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.#sql`DELETE FROM companies WHERE id = ${id} RETURNING 1`;
    return rows.length > 0;
  }
}

async function select(sql: Queryable, id: string | null): Promise<CompanyWithRoutes[]> {
  const rows = await sql<CompanyRow[]>`
    SELECT c.id, c.name,
      COALESCE(
        (SELECT json_agg(json_build_object('id', r.id, 'name', r.name, 'kind', r.kind) ORDER BY r.position)
         FROM routes r WHERE r.company_id = c.id),
        '[]'::json
      ) AS routes
    FROM companies c
    ${id === null ? sql`` : sql`WHERE c.id = ${id}`}
    ORDER BY lower(c.name)`;
  return rows.map((row) => ({ id: row.id, name: row.name, routes: row.routes }));
}

/** Keeps the ids the company already owns (so rotation history survives a rename or reorder). */
async function replaceRoutes(sql: Queryable, companyId: string, routes: RouteInput[]): Promise<void> {
  const existing = await sql<{ id: string }[]>`SELECT id FROM routes WHERE company_id = ${companyId}`;
  const owned = new Set(existing.map((row) => row.id));
  const kept = new Set(routes.flatMap((route) => (route.id !== undefined && owned.has(route.id) ? [route.id] : [])));
  for (const id of owned) {
    if (!kept.has(id)) await sql`DELETE FROM routes WHERE id = ${id}`;
  }
  for (const [position, route] of routes.entries()) {
    if (route.id !== undefined && kept.has(route.id)) {
      await sql`UPDATE routes SET name = ${route.name}, kind = ${route.kind}, position = ${position} WHERE id = ${route.id}`;
    } else {
      await sql`
        INSERT INTO routes (company_id, name, kind, position) VALUES (${companyId}, ${route.name}, ${route.kind}, ${position})`;
    }
  }
}
