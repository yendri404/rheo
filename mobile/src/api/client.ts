import type { PositionReport } from '../location/position-report';
import { apiUrl } from './api-url';
import type { TripStateView, User } from './types';

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
  NO_ROUTES: 'Esta empresa todavía no tiene rutas.',
  NO_COMPANY: 'Tu cuenta todavía no está asignada a una empresa.',
  COMPANY_REQUIRED: 'Elige una empresa.',
  FORBIDDEN: 'No tienes acceso a esta empresa.',
  NETWORK: 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES_BY_CODE[error.code] ?? error.message;
  return MESSAGES_BY_CODE.NETWORK!;
}

/**
 * React Native never gives up on a server that does not answer (an unreachable address simply
 * hangs), which would leave buttons spinning until the app is closed. Fail instead, so the user can retry.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** `fetch` that rejects when the server takes longer than `timeoutMs` to answer. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type RequestOptions = { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; token?: string; body?: unknown };

async function request<T>(path: string, { method = 'GET', token, body }: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${apiUrl()}${path}`, {
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

/** A driver registered in several companies names the one they work with; everyone else omits it. */
const inCompany = (companyId?: string) => (companyId ? `?companyId=${encodeURIComponent(companyId)}` : '');

/** Endpoints that need a session. Trip calls take the company the driver selected. */
export function authenticatedApi(token: string) {
  return {
    me: () => request<User>('/me', { token }),
    setPushToken: (pushToken: string | null) =>
      request<void>('/me/push-token', { method: 'PUT', token, body: { token: pushToken } }),
    currentTrip: (companyId?: string) => request<TripStateView>(`/trips/current${inCompany(companyId)}`, { token }),
    startTrip: (companyId?: string) => request<TripStateView>(`/trips${inCompany(companyId)}`, { method: 'POST', token }),
    joinTrip: () => request<TripStateView>('/trips/current/passengers', { method: 'POST', token }),
    leaveTrip: () => request<TripStateView>('/trips/current/passengers', { method: 'DELETE', token }),
    confirmStop: (userId: string, companyId?: string) =>
      request<TripStateView>(`/trips/current/passengers/${userId}/confirm${inCompany(companyId)}`, { method: 'POST', token }),
    finishTrip: (companyId?: string) =>
      request<TripStateView>(`/trips/current/finish${inCompany(companyId)}`, { method: 'POST', token }),
    /** Driver only. Fails with 409 NO_ACTIVE_TRIP once the trip is over. */
    reportLocation: (position: PositionReport) => request<void>('/location', { method: 'POST', token, body: position }),
  };
}

export type AuthenticatedApi = ReturnType<typeof authenticatedApi>;
