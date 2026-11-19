import { describe, expect, it } from 'vitest';
import { nextRoute } from '../src/trips/route.ts';
import { flush, setup } from './support.ts';

describe('route rotation', () => {
  it('rotates manana -> norte -> sur -> manana and starts at manana', () => {
    expect(nextRoute(null)).toBe('manana');
    expect(nextRoute('manana')).toBe('norte');
    expect(nextRoute('norte')).toBe('sur');
    expect(nextRoute('sur')).toBe('manana');
  });
});

describe('TripService', () => {
  it('starts with no active trip and manana as the next route', async () => {
    const { service } = await setup();
    expect(await service.state()).toEqual({ activeTrip: null, nextRoute: 'manana' });
  });

  it('lets the driver start a trip, publishes it and notifies passengers with push tokens', async () => {
    const { service, driver, ana, users, events, notifier } = await setup();
    await users.setPushToken(ana.id, 'ExponentPushToken[ana]');

    const state = await service.start(driver);
    await flush();

    expect(state.activeTrip?.route).toBe('manana');
    expect(state.activeTrip?.passengers).toEqual([]);
    expect(state.nextRoute).toBe('norte');
    expect(events.published).toEqual([state]);
    expect(notifier.calls).toEqual([{ route: 'manana', tokens: ['ExponentPushToken[ana]'] }]);
  });

  it('still starts the trip when the push service fails', async () => {
    const { service, driver, ana, users, notifier, errors } = await setup();
    await users.setPushToken(ana.id, 'ExponentPushToken[ana]');
    notifier.fail = true;

    const state = await service.start(driver);
    await flush();

    expect(state.activeTrip).not.toBeNull();
    expect(errors).toHaveLength(1);
  });

  it('rejects starting a second trip while one is active', async () => {
    const { service, driver } = await setup();
    await service.start(driver);
    await expect(service.start(driver)).rejects.toMatchObject({ code: 'TRIP_ALREADY_ACTIVE' });
  });

  it('rejects passengers starting, confirming or finishing trips', async () => {
    const { service, driver, ana } = await setup();
    await expect(service.start(ana)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await service.start(driver);
    await expect(service.confirmStop(ana, ana.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.finish(ana)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects the driver joining as a passenger', async () => {
    const { service, driver } = await setup();
    await service.start(driver);
    await expect(service.join(driver)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects joining when no trip is active', async () => {
    const { service, ana } = await setup();
    await expect(service.join(ana)).rejects.toMatchObject({ code: 'NO_ACTIVE_TRIP' });
  });

  it('adds a joining passenger with name and address, idempotently, and publishes each change', async () => {
    const { service, driver, ana, events } = await setup();
    await service.start(driver);

    await service.join(ana);
    const state = await service.join(ana);

    expect(state.activeTrip?.passengers).toEqual([
      { userId: ana.id, name: 'Ana', address: 'Calle 1', joinedAt: new Date('2026-11-19T12:00:00Z'), confirmedAt: null },
    ]);
    expect(events.published).toHaveLength(3);
  });

  it('confirms a passenger stop', async () => {
    const { service, driver, ana } = await setup();
    await service.start(driver);
    await service.join(ana);

    const state = await service.confirmStop(driver, ana.id);

    expect(state.activeTrip?.passengers[0]?.confirmedAt).toEqual(new Date('2026-11-19T12:00:00Z'));
  });

  it('rejects confirming a passenger that is not in the trip', async () => {
    const { service, driver, beto } = await setup();
    await service.start(driver);
    await expect(service.confirmStop(driver, beto.id)).rejects.toMatchObject({ code: 'PASSENGER_NOT_IN_TRIP' });
  });

  it('only finishes once every stop is confirmed, then rotates the next route', async () => {
    const { service, driver, ana, beto } = await setup();
    await service.start(driver);
    await service.join(ana);
    await service.join(beto);
    await service.confirmStop(driver, ana.id);

    await expect(service.finish(driver)).rejects.toMatchObject({ code: 'PENDING_STOPS' });

    await service.confirmStop(driver, beto.id);
    const state = await service.finish(driver);

    expect(state).toEqual({ activeTrip: null, nextRoute: 'norte' });
  });

  it('allows finishing a trip nobody joined', async () => {
    const { service, driver } = await setup();
    await service.start(driver);
    expect(await service.finish(driver)).toEqual({ activeTrip: null, nextRoute: 'norte' });
  });

  it('rejects finishing when no trip is active', async () => {
    const { service, driver } = await setup();
    await expect(service.finish(driver)).rejects.toMatchObject({ code: 'NO_ACTIVE_TRIP' });
  });

  it('rotates through all three routes across consecutive trips', async () => {
    const { service, driver } = await setup();
    const routes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const started = await service.start(driver);
      routes.push(started.activeTrip!.route);
      await service.finish(driver);
    }
    expect(routes).toEqual(['manana', 'norte', 'sur', 'manana']);
  });
});
