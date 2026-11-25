import type { TripNotifier } from '../../trips/ports.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_MESSAGES_PER_REQUEST = 100;

type Fetch = typeof fetch;

/** Sends through Expo's free push service, which relays to FCM (Android) and APNs (iOS). */
export class ExpoPushNotifier implements TripNotifier {
  readonly #fetch: Fetch;
  readonly #accessToken: string | undefined;

  constructor(options: { fetch?: Fetch; accessToken?: string } = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#accessToken = options.accessToken;
  }

  async tripStarted(routeName: string, pushTokens: string[]): Promise<void> {
    const messages = pushTokens.map((to) => ({
      to,
      sound: 'default',
      title: `Ruta ${routeName} iniciada`,
      body: 'El chofer comenzó la ruta. Abre la app si vas a usar el transporte.',
      data: { type: 'trip.started', route: routeName },
    }));

    for (let i = 0; i < messages.length; i += MAX_MESSAGES_PER_REQUEST) {
      const response = await this.#fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(this.#accessToken ? { authorization: `Bearer ${this.#accessToken}` } : {}),
        },
        body: JSON.stringify(messages.slice(i, i + MAX_MESSAGES_PER_REQUEST)),
      });
      if (!response.ok) throw new Error(`Expo push failed with HTTP ${response.status}`);
    }
  }
}
