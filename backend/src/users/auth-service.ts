import { AppError } from '../shared/app-error.ts';
import { hashPassword, verifyPassword } from './password.ts';
import type { User, UserRepository } from './user.ts';

export class AuthService {
  readonly #users: UserRepository;
  #dummyHash: Promise<string> | undefined;

  constructor(users: UserRepository) {
    this.#users = users;
  }

  async login(email: string, password: string): Promise<User> {
    const found = await this.#users.findByEmail(email);
    // Verify against a dummy hash for unknown emails so response time does not reveal which emails exist.
    const hash = found?.passwordHash ?? (await (this.#dummyHash ??= hashPassword('dummy-password')));
    const valid = await verifyPassword(password, hash);
    if (!found || !valid) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password.');
    const { passwordHash: _omit, ...user } = found;
    return user;
  }

  /** Self sign-up always creates a passenger. Drivers are promoted manually (scripts/set-role.ts). */
  async register(input: { name: string; email: string; password: string; address: string }): Promise<User> {
    return this.#users.create({
      name: input.name,
      email: input.email,
      address: input.address,
      role: 'passenger',
      passwordHash: await hashPassword(input.password),
    });
  }
}
