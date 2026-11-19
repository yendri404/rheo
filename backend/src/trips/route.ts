export const ROUTES = ['manana', 'norte', 'sur'] as const;

export type RouteName = (typeof ROUTES)[number];

export const ROUTE_LABELS: Record<RouteName, string> = {
  manana: 'Mañana',
  norte: 'Norte',
  sur: 'Sur',
};

/** Routes rotate on every started trip: Mañana -> Norte -> Sur -> Mañana. */
export function nextRoute(lastRoute: RouteName | null): RouteName {
  if (lastRoute === null) return ROUTES[0];
  const index = ROUTES.indexOf(lastRoute);
  return ROUTES[(index + 1) % ROUTES.length]!;
}
