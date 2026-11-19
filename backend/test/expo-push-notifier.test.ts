import { describe, expect, it } from 'vitest';
import { ExpoPushNotifier } from '../src/infrastructure/expo/expo-push-notifier.ts';

function recordingFetch(status = 200) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return new Response('{}', { status });
  }) as typeof fetch;
  return { requests, fetchFn };
}

describe('ExpoPushNotifier', () => {
  it('sends one message per token with the route label', async () => {
    const { requests, fetchFn } = recordingFetch();
    await new ExpoPushNotifier({ fetch: fetchFn }).tripStarted('manana', ['ExponentPushToken[a]']);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://exp.host/--/api/v2/push/send');
    expect(JSON.parse(requests[0]!.init.body as string)).toEqual([
      expect.objectContaining({ to: 'ExponentPushToken[a]', title: 'Ruta Mañana iniciada', data: { type: 'trip.started', route: 'manana' } }),
    ]);
  });

  it('batches in chunks of 100 tokens', async () => {
    const { requests, fetchFn } = recordingFetch();
    const tokens = Array.from({ length: 150 }, (_, i) => `ExponentPushToken[${i}]`);
    await new ExpoPushNotifier({ fetch: fetchFn }).tripStarted('sur', tokens);

    expect(requests.map((request) => JSON.parse(request.init.body as string).length)).toEqual([100, 50]);
  });

  it('throws when Expo answers with an error status', async () => {
    const { fetchFn } = recordingFetch(503);
    await expect(new ExpoPushNotifier({ fetch: fetchFn }).tripStarted('sur', ['t'])).rejects.toThrow('HTTP 503');
  });
});
