export type Role = 'driver' | 'passenger';

export type User = {
  id: string;
  email: string;
  name: string;
  address: string;
  role: Role;
};

export type UserWithCredentials = User & { passwordHash: string };

export type NewUser = Omit<UserWithCredentials, 'id'>;

export interface UserRepository {
  /** Throws AppError EMAIL_TAKEN when the normalized email already exists. */
  create(user: NewUser): Promise<User>;
  /** Returns false when no user has that email. */
  setRole(email: string, role: Role): Promise<boolean>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<UserWithCredentials | null>;
  setPushToken(userId: string, token: string | null): Promise<void>;
  pushTokensFor(role: Role): Promise<string[]>;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
