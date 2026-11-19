export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_TAKEN'
  | 'FORBIDDEN'
  | 'TRIP_ALREADY_ACTIVE'
  | 'NO_ACTIVE_TRIP'
  | 'PASSENGER_NOT_IN_TRIP'
  | 'PENDING_STOPS'
  | 'VALIDATION_FAILED';

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}
