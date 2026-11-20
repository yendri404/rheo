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

/** What the admin panel lists: never includes the password hash. */
export type UserSummary = User & { createdAt: Date };

export type UserPatch = Partial<Pick<UserWithCredentials, 'email' | 'name' | 'address' | 'role' | 'passwordHash'>>;

export interface UserRepository {
  /** Throws AppError EMAIL_TAKEN when the normalized email already exists. */
  create(user: NewUser): Promise<User>;
  /** Returns false when no user has that email. */
  setRole(email: string, role: Role): Promise<boolean>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<UserWithCredentials | null>;
  setPushToken(userId: string, token: string | null): Promise<void>;
  pushTokensFor(role: Role): Promise<string[]>;
  /** Drivers first, then passengers; each group by name. */
  list(): Promise<UserSummary[]>;
  /** Returns null for an unknown id. Throws AppError EMAIL_TAKEN if the new email belongs to someone else. */
  update(id: string, patch: UserPatch): Promise<User | null>;
  /** Returns false for an unknown id. */
  delete(id: string): Promise<boolean>;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
