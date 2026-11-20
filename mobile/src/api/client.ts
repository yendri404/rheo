import type { PositionReport } from '../location/position-report';
import type { TripStateView, User } from './types';

/** Set EXPO_PUBLIC_API_URL to your machine's LAN IP when testing on a physical phone. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const WS_URL = `${API_URL.replace(/^http/, 'ws')}/ws`;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MESSAGES_BY_CODE: Record<string, string> = {
  INVALID_CREDENTIALS: 'Correo o contraseña incorrectos.',
  VALIDATION_FAILED: 'Revisa los datos ingresados.',
  NO_ACTIVE_TRIP: 'No hay ninguna ruta en curso.',
  TRIP_ALREADY_ACTIVE: 'Ya hay una ruta en curso.',
  PENDING_STOPS: 'Faltan paradas por confirmar.',
  STOP_ALREADY_CONFIRMED: 'El chofer ya confirmó tu parada.',
  NETWORK: 'No se pudo conectar con el servidor.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES_BY_CODE[error.code] ?? error.message;
  return MESSAGES_BY_CODE.NETWORK!;
}

type RequestOptions = { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; token?: string; body?: unknown };

async function request<T>(path: string, { method = 'GET', token, body }: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, payload?.error?.code ?? 'UNKNOWN', payload?.error?.message ?? 'Request failed');
  }
  return payload as T;
}

export type AuthResult = { token: string; user: User };

export function login(email: string, password: string) {
  return request<AuthResult>('/auth/login', { method: 'POST', body: { email, password } });
}

/** Endpoints that need a session. */
export function authenticatedApi(token: string) {
  return {
    me: () => request<User>('/me', { token }),
    setPushToken: (pushToken: string | null) =>
      request<void>('/me/push-token', { method: 'PUT', token, body: { token: pushToken } }),
    currentTrip: () => request<TripStateView>('/trips/current', { token }),
    startTrip: () => request<TripStateView>('/trips', { method: 'POST', token }),
    joinTrip: () => request<TripStateView>('/trips/current/passengers', { method: 'POST', token }),
    leaveTrip: () => request<TripStateView>('/trips/current/passengers', { method: 'DELETE', token }),
    confirmStop: (userId: string) =>
      request<TripStateView>(`/trips/current/passengers/${userId}/confirm`, { method: 'POST', token }),
    finishTrip: () => request<TripStateView>('/trips/current/finish', { method: 'POST', token }),
    /** Driver only. Fails with 409 NO_ACTIVE_TRIP once the trip is over. */
    reportLocation: (position: PositionReport) => request<void>('/location', { method: 'POST', token, body: position }),
  };
}

export type AuthenticatedApi = ReturnType<typeof authenticatedApi>;
