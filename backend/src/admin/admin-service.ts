import { AppError } from '../shared/app-error.ts';
import type { TripService } from '../trips/trip-service.ts';
import { hashPassword } from '../users/password.ts';
import type { Role, UserPatch, UserRepository, UserSummary } from '../users/user.ts';

export type NewUserInput = { name: string; email: string; address: string; role: Role; password: string };
export type UserChanges = Partial<Omit<NewUserInput, 'password'>> & { password?: string };

/**
 * User management for the admin panel. Guards the running trip: nobody in it can be deleted or
 * have their role changed (a passenger would vanish from the driver's list, or the trip would
 * lose its driver).
 */
export class AdminService {
  readonly #users: UserRepository;
  readonly #tripService: TripService;

  constructor(users: UserRepository, tripService: TripService) {
    this.#users = users;
    this.#tripService = tripService;
  }

  list(): Promise<UserSummary[]> {
    return this.#users.list();
  }

  async create(input: NewUserInput): Promise<UserSummary> {
    const { password, ...user } = input;
    requireAddressForPassenger(user.role, user.address);
    const created = await this.#users.create({ ...user, passwordHash: await hashPassword(password) });
    return this.#summary(created.id);
  }

  async update(id: string, changes: UserChanges): Promise<UserSummary> {
    const current = await this.#users.findById(id);
    if (!current) throw notFound();
    const role = changes.role ?? current.role;
    requireAddressForPassenger(role, changes.address ?? current.address);
    if (role !== current.role && (await this.#isInRunningTrip(id, current.role))) throw inActiveTrip();

    const { password, ...fields } = changes;
    const patch: UserPatch = { ...fields };
    if (password !== undefined) patch.passwordHash = await hashPassword(password);
    if (!(await this.#users.update(id, patch))) throw notFound();
    return this.#summary(id);
  }

  async delete(id: string): Promise<void> {
    const current = await this.#users.findById(id);
    if (!current) throw notFound();
    if (await this.#isInRunningTrip(id, current.role)) throw inActiveTrip();
    await this.#users.delete(id);
  }

  async #isInRunningTrip(id: string, role: Role): Promise<boolean> {
    const trip = (await this.#tripService.state()).activeTrip;
    if (!trip) return false;
    // Trips are not tied to a specific driver, so any running trip needs its drivers.
    return role === 'driver' || trip.passengers.some((passenger) => passenger.userId === id);
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

function inActiveTrip(): AppError {
  return new AppError('USER_IN_ACTIVE_TRIP', 'This user is part of the trip in progress. Try again when it finishes.');
}
