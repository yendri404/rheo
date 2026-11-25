import type { Company } from '../companies/company.ts';

export type Role = 'driver' | 'passenger';

export type User = {
  id: string;
  email: string;
  name: string;
  address: string;
  role: Role;
  /** Companies the user is registered in, sorted by name. They only see and run those routes. */
  companies: Company[];
};

export type UserWithCredentials = User & { passwordHash: string };

export type NewUser = Omit<UserWithCredentials, 'id' | 'companies'> & { companyIds: string[] };

/** What the admin panel lists: never includes the password hash. */
export type UserSummary = User & { createdAt: Date };

/** `companyIds` replaces the whole membership list. */
export type UserPatch = Partial<Pick<UserWithCredentials, 'email' | 'name' | 'address' | 'role' | 'passwordHash'>> & {
  companyIds?: string[];
};

export interface UserRepository {
  /** Throws AppError EMAIL_TAKEN when the normalized email already exists. */
  create(user: NewUser): Promise<User>;
  /** Returns false when no user has that email. */
  setRole(email: string, role: Role): Promise<boolean>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<UserWithCredentials | null>;
  setPushToken(userId: string, token: string | null): Promise<void>;
  /** Tokens of the members of one company with that role. */
  pushTokensFor(role: Role, companyId: string): Promise<string[]>;
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

export function isMember(user: User, companyId: string): boolean {
  return user.companies.some((company) => company.id === companyId);
}
