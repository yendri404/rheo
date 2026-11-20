import { randomUUID } from 'node:crypto';
import { emailTaken } from '../../users/errors.ts';
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

type StoredUser = UserWithCredentials & { pushToken: string | null; createdAt: Date };

/** Test and local-dev adapter. */
export class InMemoryUserRepository implements UserRepository {
  readonly #users = new Map<string, StoredUser>();

  async create(input: NewUser): Promise<User> {
    const email = normalizeEmail(input.email);
    if ([...this.#users.values()].some((user) => user.email === email)) {
      throw emailTaken();
    }
    const user: StoredUser = { ...input, email, id: randomUUID(), pushToken: null, createdAt: new Date() };
    this.#users.set(user.id, user);
    return toUser(user);
  }

  async list(): Promise<UserSummary[]> {
    return [...this.#users.values()]
      .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name))
      .map((user) => ({ ...toUser(user), createdAt: user.createdAt }));
  }

  async update(id: string, patch: UserPatch): Promise<User | null> {
    const user = this.#users.get(id);
    if (!user) return null;
    const email = patch.email === undefined ? undefined : normalizeEmail(patch.email);
    if (email && [...this.#users.values()].some((other) => other.id !== id && other.email === email)) throw emailTaken();
    Object.assign(user, Object.fromEntries(Object.entries({ ...patch, email }).filter(([, value]) => value !== undefined)));
    return toUser(user);
  }

  async delete(id: string): Promise<boolean> {
    return this.#users.delete(id);
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
