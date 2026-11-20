export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_TAKEN'
  | 'FORBIDDEN'
  | 'TRIP_ALREADY_ACTIVE'
  | 'NO_ACTIVE_TRIP'
  | 'PASSENGER_NOT_IN_TRIP'
  | 'PENDING_STOPS'
  | 'STOP_ALREADY_CONFIRMED'
  | 'VALIDATION_FAILED'
  | 'USER_NOT_FOUND'
  | 'USER_IN_ACTIVE_TRIP'
  | 'TOO_MANY_ATTEMPTS';

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}
