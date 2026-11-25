import { AppError } from '../shared/app-error.ts';
import { isMember, type User } from '../users/user.ts';

/**
 * The company a request is about. A user registered in a single company never has to name it;
 * one registered in several (a driver) must choose. Naming a company the user is not registered
 * in is always refused, so nobody can read or run another company's routes.
 */
export function resolveCompany(user: User, requested: string | undefined): string {
  if (requested !== undefined) {
    if (!isMember(user, requested)) throw new AppError('FORBIDDEN', 'You are not registered in this company.');
    return requested;
  }
  const [first, ...others] = user.companies;
  if (!first) throw new AppError('NO_COMPANY', 'You are not registered in any company yet.');
  if (others.length > 0) throw new AppError('COMPANY_REQUIRED', 'Choose which company to work with.');
  return first.id;
}
