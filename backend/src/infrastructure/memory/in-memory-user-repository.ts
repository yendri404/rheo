import { randomUUID } from 'node:crypto';
import { emailTaken } from '../../users/errors.ts';
import { normalizeEmail, type NewUser, type Role, type User, type UserRepository, type UserWithCredentials } from '../../users/user.ts';

/** Test and local-dev adapter. */
export class InMemoryUserRepository implements UserRepository {
  readonly #users = new Map<string, UserWithCredentials & { pushToken: string | null }>();

  async create(input: NewUser): Promise<User> {
    const email = normalizeEmail(input.email);
    if ([...this.#users.values()].some((user) => user.email === email)) {
      throw emailTaken();
    }
    const user = { ...input, email, id: randomUUID(), pushToken: null };
    this.#users.set(user.id, user);
    return toUser(user);
  }

  async setRole(email: string, role: Role): Promise<boolean> {
    const wanted = normalizeEmail(email);
    const user = [...this.#users.values()].find((candidate) => candidate.email === wanted);
    if (!user) return false;
    user.role = role;
    return true;
  }

  async findById(id: string): Promise<User | null> {
    const user = this.#users.get(id);
    return user ? toUser(user) : null;
  }

  async findByEmail(email: string): Promise<UserWithCredentials | null> {
    const wanted = normalizeEmail(email);
    const user = [...this.#users.values()].find((candidate) => candidate.email === wanted);
    return user ? { ...toUser(user), passwordHash: user.passwordHash } : null;
  }

  async setPushToken(userId: string, token: string | null): Promise<void> {
    // A device token belongs to one user at a time (shared phones re-login).
    for (const user of this.#users.values()) {
      if (token !== null && user.pushToken === token) user.pushToken = null;
    }
    const user = this.#users.get(userId);
    if (user) user.pushToken = token;
  }

  async pushTokensFor(role: Role): Promise<string[]> {
    return [...this.#users.values()]
      .filter((user) => user.role === role && user.pushToken !== null)
      .map((user) => user.pushToken!);
  }
}

function toUser({ id, email, name, address, role }: UserWithCredentials): User {
  return { id, email, name, address, role };
}
