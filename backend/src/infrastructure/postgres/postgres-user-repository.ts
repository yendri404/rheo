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
import { isUniqueViolation, type Sql } from './database.ts';

type UserRow = { id: string; email: string; name: string; address: string; role: Role; password_hash: string };

export class PostgresUserRepository implements UserRepository {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async create(user: NewUser): Promise<User> {
    try {
      const [row] = await this.#sql<UserRow[]>`
        INSERT INTO users (email, password_hash, name, address, role)
        VALUES (${normalizeEmail(user.email)}, ${user.passwordHash}, ${user.name}, ${user.address}, ${user.role})
        RETURNING id, email, name, address, role, password_hash`;
      return toUser(row!);
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_key')) throw emailTaken();
      throw error;
    }
  }

  async list(): Promise<UserSummary[]> {
    const rows = await this.#sql<(UserRow & { created_at: Date })[]>`
      SELECT id, email, name, address, role, password_hash, created_at FROM users ORDER BY role, name`;
    return rows.map((row) => ({ ...toUser(row), createdAt: row.created_at }));
  }

  async update(id: string, patch: UserPatch): Promise<User | null> {
    const columns: Record<string, string> = {};
    if (patch.email !== undefined) columns.email = normalizeEmail(patch.email);
    if (patch.name !== undefined) columns.name = patch.name;
    if (patch.address !== undefined) columns.address = patch.address;
    if (patch.role !== undefined) columns.role = patch.role;
    if (patch.passwordHash !== undefined) columns.password_hash = patch.passwordHash;
    if (Object.keys(columns).length === 0) return this.findById(id);
    try {
      // sql(columns) expands to a parameterized "col = $n, ..." list, only for the fields provided.
      const [row] = await this.#sql<UserRow[]>`
        UPDATE users SET ${this.#sql(columns)} WHERE id = ${id}
        RETURNING id, email, name, address, role, password_hash`;
      return row ? toUser(row) : null;
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
    const [row] = await this.#sql<UserRow[]>`
      SELECT id, email, name, address, role, password_hash FROM users WHERE id = ${id}`;
    return row ? toUser(row) : null;
  }

  async findByEmail(email: string): Promise<UserWithCredentials | null> {
    const [row] = await this.#sql<UserRow[]>`
      SELECT id, email, name, address, role, password_hash FROM users WHERE email = ${normalizeEmail(email)}`;
    return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
  }

  async setPushToken(userId: string, token: string | null): Promise<void> {
    await this.#sql.begin(async (tx) => {
      // A device token belongs to one user at a time (shared phones re-login).
      if (token !== null) await tx`UPDATE users SET push_token = NULL WHERE push_token = ${token} AND id <> ${userId}`;
      await tx`UPDATE users SET push_token = ${token} WHERE id = ${userId}`;
    });
  }

  async pushTokensFor(role: Role): Promise<string[]> {
    const rows = await this.#sql<{ push_token: string }[]>`
      SELECT push_token FROM users WHERE role = ${role} AND push_token IS NOT NULL`;
    return rows.map((row) => row.push_token);
  }
}

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, address: row.address, role: row.role };
}
