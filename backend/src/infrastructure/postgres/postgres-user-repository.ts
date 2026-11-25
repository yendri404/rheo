import type { Company } from '../../companies/company.ts';
import {
  normalizeEmail,
  type NewUser,
  type Role,
  type User,
  type UserPatch,
  type UserRepository,
  type UserSummary,
  type UserWithCredentials,
} from '../../users/user.ts';
import { emailTaken } from '../../users/errors.ts';
import { isUniqueViolation, type Fragment, type Queryable, type Sql } from './database.ts';

type UserRow = {
  id: string;
  email: string;
  name: string;
  address: string;
  role: Role;
  password_hash: string;
  created_at: Date;
  companies: Company[];
};

export class PostgresUserRepository implements UserRepository {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async create(user: NewUser): Promise<User> {
    try {
      return await this.#sql.begin(async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO users (email, password_hash, name, address, role)
          VALUES (${normalizeEmail(user.email)}, ${user.passwordHash}, ${user.name}, ${user.address}, ${user.role})
          RETURNING id`;
        await setCompanies(tx, row!.id, user.companyIds);
        return toUser((await select(tx, tx`WHERE u.id = ${row!.id}`))[0]!);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_key')) throw emailTaken();
      throw error;
    }
  }

  async list(): Promise<UserSummary[]> {
    const rows = await select(this.#sql, this.#sql``);
    return rows.map((row) => ({ ...toUser(row), createdAt: row.created_at }));
  }

  async update(id: string, patch: UserPatch): Promise<User | null> {
    const columns: Record<string, string> = {};
    if (patch.email !== undefined) columns.email = normalizeEmail(patch.email);
    if (patch.name !== undefined) columns.name = patch.name;
    if (patch.address !== undefined) columns.address = patch.address;
    if (patch.role !== undefined) columns.role = patch.role;
    if (patch.passwordHash !== undefined) columns.password_hash = patch.passwordHash;
    try {
      return await this.#sql.begin(async (tx) => {
        const [existing] = await tx`SELECT 1 FROM users WHERE id = ${id} FOR UPDATE`;
        if (!existing) return null;
        // sql(columns) expands to a parameterized "col = $n, ..." list, only for the fields provided.
        if (Object.keys(columns).length > 0) await tx`UPDATE users SET ${tx(columns)} WHERE id = ${id}`;
        if (patch.companyIds !== undefined) await setCompanies(tx, id, patch.companyIds);
        const [row] = await select(tx, tx`WHERE u.id = ${id}`);
        return row ? toUser(row) : null;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_key')) throw emailTaken();
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.#sql`DELETE FROM users WHERE id = ${id} RETURNING 1`;
    return rows.length > 0;
  }

  async setRole(email: string, role: Role): Promise<boolean> {
    const rows = await this.#sql`UPDATE users SET role = ${role} WHERE email = ${normalizeEmail(email)} RETURNING 1`;
    return rows.length > 0;
  }

  async findById(id: string): Promise<User | null> {
    const [row] = await select(this.#sql, this.#sql`WHERE u.id = ${id}`);
    return row ? toUser(row) : null;
  }

  async findByEmail(email: string): Promise<UserWithCredentials | null> {
    const [row] = await select(this.#sql, this.#sql`WHERE u.email = ${normalizeEmail(email)}`);
    return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
  }

  async setPushToken(userId: string, token: string | null): Promise<void> {
    await this.#sql.begin(async (tx) => {
      // A device token belongs to one user at a time (shared phones re-login).
      if (token !== null) await tx`UPDATE users SET push_token = NULL WHERE push_token = ${token} AND id <> ${userId}`;
      await tx`UPDATE users SET push_token = ${token} WHERE id = ${userId}`;
    });
  }

  async pushTokensFor(role: Role, companyId: string): Promise<string[]> {
    const rows = await this.#sql<{ push_token: string }[]>`
      SELECT u.push_token FROM users u
      JOIN user_companies uc ON uc.user_id = u.id
      WHERE u.role = ${role} AND uc.company_id = ${companyId} AND u.push_token IS NOT NULL`;
    return rows.map((row) => row.push_token);
  }
}

/** Users with their companies (sorted by name), drivers first and then by name. */
async function select(sql: Queryable, where: Fragment): Promise<UserRow[]> {
  return sql<UserRow[]>`
    SELECT u.id, u.email, u.name, u.address, u.role, u.password_hash, u.created_at,
      COALESCE(
        (SELECT json_agg(json_build_object('id', c.id, 'name', c.name) ORDER BY lower(c.name))
         FROM user_companies uc JOIN companies c ON c.id = uc.company_id
         WHERE uc.user_id = u.id),
        '[]'::json
      ) AS companies
    FROM users u
    ${where}
    ORDER BY u.role, u.name`;
}

async function setCompanies(sql: Queryable, userId: string, companyIds: string[]): Promise<void> {
  await sql`DELETE FROM user_companies WHERE user_id = ${userId}`;
  for (const companyId of new Set(companyIds)) {
    await sql`INSERT INTO user_companies (user_id, company_id) VALUES (${userId}, ${companyId})`;
  }
}

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, address: row.address, role: row.role, companies: row.companies };
}
