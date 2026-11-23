// Kept free of Expo and React imports so it runs under `node --test`.
import { ROUTE_LABELS, type RouteName } from '../api/types.ts';

type TripSnapshot = { activeTrip: { id: string; route: RouteName } | null };

export type Notice = { title: string; body: string };

/**
 * The notice to show when a route starts while the app is watching the trip state, or null.
 * Mirrors the server push (backend expo-push-notifier) for clients that have no push, such as the PWA.
 * The first snapshot (previous = null) never notifies: the route was already running when the app opened.
 */
export function tripStartedNotice(previous: TripSnapshot | null, next: TripSnapshot | null): Notice | null {
  const trip = next?.activeTrip;
  if (!previous || !trip || previous.activeTrip?.id === trip.id) return null;
  return {
    title: `Ruta ${ROUTE_LABELS[trip.route]} iniciada`,
    body: 'El chofer comenzó la ruta. Abre la app si vas a usar el transporte.',
  };
}
