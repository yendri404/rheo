import { AppError } from '../shared/app-error.ts';

export function emailTaken(): AppError {
  return new AppError('EMAIL_TAKEN', 'An account with this email already exists.');
}
