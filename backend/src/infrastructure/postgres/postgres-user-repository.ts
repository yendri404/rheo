import { normalizeEmail, type NewUser, type Role, type User, type UserRepository, type UserWithCredentials } from '../../users/user.ts';
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
