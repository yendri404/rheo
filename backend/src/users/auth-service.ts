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
}
