import type { CompanyChanges, CompanyRepository, CompanyWithRoutes, RouteInput } from '../companies/company.ts';
import { AppError } from '../shared/app-error.ts';
import type { TripService } from '../trips/trip-service.ts';
import { hashPassword } from '../users/password.ts';
import { isMember, type Role, type User, type UserPatch, type UserRepository, type UserSummary } from '../users/user.ts';

export type NewUserInput = {
  name: string;
  email: string;
  address: string;
  role: Role;
  password: string;
  companyIds: string[];
};
export type UserChanges = Partial<Omit<NewUserInput, 'password'>> & { password?: string };

type Dependencies = {
  users: UserRepository;
  companies: CompanyRepository;
  tripService: TripService;
  /** Called after a user's role or companies change, or the user is deleted. */
  onUserChanged?: (userId: string) => void;
};

/**
 * User and company management for the admin panel. Guards the running trips: nobody taking part in
 * one can be deleted, change role or leave that company (a passenger would vanish from the
 * driver's list, or the trip would lose its driver), and a company cannot be deleted mid-trip.
 */
export class AdminService {
  readonly #users: UserRepository;
  readonly #companies: CompanyRepository;
  readonly #tripService: TripService;
  readonly #onUserChanged: (userId: string) => void;

  constructor(deps: Dependencies) {
    this.#users = deps.users;
    this.#companies = deps.companies;
    this.#tripService = deps.tripService;
    this.#onUserChanged = deps.onUserChanged ?? (() => {});
  }

  list(): Promise<UserSummary[]> {
    return this.#users.list();
  }

  async create(input: NewUserInput): Promise<UserSummary> {
    const { password, ...user } = input;
    requireAddressForPassenger(user.role, user.address);
    const companyIds = await this.#validCompanies(user.role, user.companyIds);
    const created = await this.#users.create({ ...user, companyIds, passwordHash: await hashPassword(password) });
    return this.#summary(created.id);
  }

  async update(id: string, changes: UserChanges): Promise<UserSummary> {
    const current = await this.#users.findById(id);
    if (!current) throw notFound();
    const role = changes.role ?? current.role;
    requireAddressForPassenger(role, changes.address ?? current.address);

    const { password, companyIds: requestedCompanies, ...fields } = changes;
    const patch: UserPatch = { ...fields };
    const membershipChanges = role !== current.role || requestedCompanies !== undefined;
    if (membershipChanges) {
      const companyIds = await this.#validCompanies(role, requestedCompanies ?? current.companies.map((company) => company.id));
      const busyIn = await this.#companiesWithRunningTrip(current);
      if (busyIn.length > 0 && (role !== current.role || busyIn.some((companyId) => !companyIds.includes(companyId)))) {
        throw inActiveTrip();
      }
      if (requestedCompanies !== undefined) patch.companyIds = companyIds;
    }
    if (password !== undefined) patch.passwordHash = await hashPassword(password);
    if (!(await this.#users.update(id, patch))) throw notFound();
    if (membershipChanges) this.#onUserChanged(id);
    return this.#summary(id);
  }

  async delete(id: string): Promise<void> {
    const current = await this.#users.findById(id);
    if (!current) throw notFound();
    if ((await this.#companiesWithRunningTrip(current)).length > 0) throw inActiveTrip();
    await this.#users.delete(id);
    this.#onUserChanged(id);
  }

  listCompanies(): Promise<CompanyWithRoutes[]> {
    return this.#companies.list();
  }

  createCompany(input: { name: string; routes: RouteInput[] }): Promise<CompanyWithRoutes> {
    return this.#companies.create(input.name, input.routes);
  }

  async updateCompany(id: string, changes: CompanyChanges): Promise<CompanyWithRoutes> {
    const updated = await this.#companies.update(id, changes);
    if (!updated) throw companyNotFound();
    return updated;
  }

  /** Refused while the company has members (move them first) or a running trip. */
  async deleteCompany(id: string): Promise<void> {
    if (!(await this.#companies.findById(id))) throw companyNotFound();
    if ((await this.#tripService.activeTrips()).some((trip) => trip.companyId === id)) {
      throw new AppError('COMPANY_IN_ACTIVE_TRIP', 'This company has a trip in progress. Try again when it finishes.');
    }
    if ((await this.#users.list()).some((user) => isMember(user, id))) {
      throw new AppError('COMPANY_HAS_MEMBERS', 'Move or remove the users of this company before deleting it.');
    }
    await this.#companies.delete(id);
  }

  /** Passengers have no company selector, so they belong to exactly one; drivers to one or more. */
  async #validCompanies(role: Role, requested: string[]): Promise<string[]> {
    const companyIds = [...new Set(requested)];
    const known = new Set((await this.#companies.list()).map((company) => company.id));
    if (companyIds.some((companyId) => !known.has(companyId))) throw companyNotFound();
    if (role === 'passenger' && companyIds.length !== 1) {
      throw new AppError('VALIDATION_FAILED', 'Passengers belong to exactly one company.');
    }
    if (companyIds.length === 0) throw new AppError('VALIDATION_FAILED', 'Drivers need at least one company.');
    return companyIds;
  }

  /** Companies whose running trip this user takes part in. */
  async #companiesWithRunningTrip(user: User): Promise<string[]> {
    return (await this.#tripService.activeTrips())
      .filter((trip) =>
        // Any driver of the company can confirm stops and finish, so a running trip needs its drivers.
        user.role === 'driver'
          ? isMember(user, trip.companyId)
          : trip.passengers.some((passenger) => passenger.userId === user.id),
      )
      .map((trip) => trip.companyId);
  }

  async #summary(id: string): Promise<UserSummary> {
    const user = (await this.#users.list()).find((candidate) => candidate.id === id);
    if (!user) throw notFound();
    return user;
  }
}

function requireAddressForPassenger(role: Role, address: string): void {
  if (role === 'passenger' && address.trim() === '') {
    throw new AppError('VALIDATION_FAILED', 'Passengers need a pickup address.');
  }
}

function notFound(): AppError {
  return new AppError('USER_NOT_FOUND', 'User not found.');
}

function companyNotFound(): AppError {
  return new AppError('COMPANY_NOT_FOUND', 'Company not found.');
}

function inActiveTrip(): AppError {
  return new AppError('USER_IN_ACTIVE_TRIP', 'This user is part of the trip in progress. Try again when it finishes.');
}
