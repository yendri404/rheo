import { describe, expect, it } from 'vitest';
import { nextRoute, type Route } from '../src/companies/company.ts';
import { flush, setup } from './support.ts';

describe('route rotation', () => {
  const routes: Route[] = [
    { id: 'a', name: 'Mañana', kind: 'pickup' },
    { id: 'b', name: 'Norte', kind: 'dropoff' },
    { id: 'c', name: 'Sur', kind: 'dropoff' },
  ];

  it('rotates through the company routes in order and starts at the first one', () => {
    expect(nextRoute(routes, null)?.name).toBe('Mañana');
    expect(nextRoute(routes, 'a')?.name).toBe('Norte');
    expect(nextRoute(routes, 'b')?.name).toBe('Sur');
    expect(nextRoute(routes, 'c')?.name).toBe('Mañana');
  });

  it('restarts at the first route when the last one no longer exists, and has none without routes', () => {
    expect(nextRoute(routes, 'deleted')?.name).toBe('Mañana');
    expect(nextRoute([], null)).toBeNull();
  });
});

describe('TripService', () => {
  it('starts with no active trip and the first route of the company as the next one', async () => {
    const { service, eureka } = await setup();
    expect(await service.state(eureka.id)).toEqual({ companyId: eureka.id, activeTrip: null, nextRoute: eureka.routes[0] });
  });

  it('lets the driver start a trip, publishes it and notifies only the passengers of that company', async () => {
    const { service, driver, ana, carla, users, events, notifier, eureka } = await setup();
    await users.setPushToken(ana.id, 'ExponentPushToken[ana]');
    await users.setPushToken(carla.id, 'ExponentPushToken[carla]');

    const state = await service.start(driver, eureka.id);
    await flush();

    expect(state.companyId).toBe(eureka.id);
    expect(state.activeTrip).toMatchObject({
      companyId: eureka.id,
      driverId: driver.id,
      route: { name: 'Mañana', kind: 'pickup' },
      passengers: [],
    });
    expect(state.nextRoute?.name).toBe('Norte');
    expect(events.published).toEqual([state]);
    expect(notifier.calls).toEqual([{ route: 'Mañana', tokens: ['ExponentPushToken[ana]'] }]);
  });

  it('still starts the trip when the push service fails', async () => {
    const { service, driver, ana, users, notifier, errors, eureka } = await setup();
    await users.setPushToken(ana.id, 'ExponentPushToken[ana]');
    notifier.fail = true;

    const state = await service.start(driver, eureka.id);
    await flush();

    expect(state.activeTrip).not.toBeNull();
    expect(errors).toHaveLength(1);
  });

  it('rejects starting a second trip in a company while one is active', async () => {
    const { service, driver, eureka } = await setup();
    await service.start(driver, eureka.id);
    await expect(service.start(driver, eureka.id)).rejects.toMatchObject({ code: 'TRIP_ALREADY_ACTIVE' });
  });

  it('runs the trips of two companies independently, each with its own rotation', async () => {
    const { service, driver, ana, carla, eureka, acme } = await setup();
    await service.start(driver, eureka.id);
    const acmeState = await service.start(driver, acme.id);

    expect(acmeState.activeTrip?.route.name).toBe('Centro');
    await service.join(ana, eureka.id);
    await service.join(carla, acme.id);
    expect((await service.state(eureka.id)).activeTrip?.passengers.map((p) => p.userId)).toEqual([ana.id]);
    expect((await service.state(acme.id)).activeTrip?.passengers.map((p) => p.userId)).toEqual([carla.id]);

    await service.confirmStop(driver, acme.id, carla.id);
    expect(await service.finish(driver, acme.id)).toMatchObject({ activeTrip: null, nextRoute: { name: 'Centro' } });
    expect((await service.state(eureka.id)).activeTrip).not.toBeNull();
    expect((await service.activeTrips()).map((trip) => trip.companyId)).toEqual([eureka.id]);
  });

  it('rejects every action on a company the user does not belong to', async () => {
    const { service, users, driver, ana, carla, eureka, acme } = await setup();
    const outsider = await users.create({
      email: 'other@test.dev',
      passwordHash: 'x',
      name: 'Other',
      address: '',
      role: 'driver',
      companyIds: [acme.id],
    });
    await expect(service.start(outsider, eureka.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await service.start(driver, eureka.id);
    await service.join(ana, eureka.id);
    await expect(service.join(carla, eureka.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.leave(carla, eureka.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.confirmStop(outsider, eureka.id, ana.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.finish(outsider, eureka.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await service.state(eureka.id)).activeTrip?.passengers.map((p) => p.userId)).toEqual([ana.id]);
  });

  it('refuses to start a trip in a company that has no routes', async () => {
    const { service, users, companies } = await setup();
    const empty = await companies.create('Empty', []);
    const driver = await users.create({
      email: 'solo@test.dev',
      passwordHash: 'x',
      name: 'Solo',
      address: '',
      role: 'driver',
      companyIds: [empty.id],
    });

    expect((await service.state(empty.id)).nextRoute).toBeNull();
    await expect(service.start(driver, empty.id)).rejects.toMatchObject({ code: 'NO_ROUTES' });
  });

  it('rejects passengers starting, confirming or finishing trips', async () => {
    const { service, driver, ana, eureka } = await setup();
    await expect(service.start(ana, eureka.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await service.start(driver, eureka.id);
    await expect(service.confirmStop(ana, eureka.id, ana.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.finish(ana, eureka.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects the driver joining as a passenger', async () => {
    const { service, driver, eureka } = await setup();
    await service.start(driver, eureka.id);
    await expect(service.join(driver, eureka.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects joining when no trip is active', async () => {
    const { service, ana, eureka } = await setup();
    await expect(service.join(ana, eureka.id)).rejects.toMatchObject({ code: 'NO_ACTIVE_TRIP' });
  });

  it('adds a joining passenger with name and address, idempotently, and publishes each change', async () => {
    const { service, driver, ana, events, eureka } = await setup();
    await service.start(driver, eureka.id);

    await service.join(ana, eureka.id);
    const state = await service.join(ana, eureka.id);

    expect(state.activeTrip?.passengers).toEqual([
      { userId: ana.id, name: 'Ana', address: 'Calle 1', joinedAt: new Date('2026-11-19T12:00:00Z'), confirmedAt: null },
    ]);
    expect(events.published).toHaveLength(3);
  });

  it('lets a passenger cancel before their stop is confirmed, then rejoin', async () => {
    const { service, driver, ana, events, eureka } = await setup();
    await service.start(driver, eureka.id);
    await service.join(ana, eureka.id);

    const afterLeave = await service.leave(ana, eureka.id);
    expect(afterLeave.activeTrip?.passengers).toEqual([]);
    expect(events.published.at(-1)).toEqual(afterLeave);

    const afterRejoin = await service.join(ana, eureka.id);
    expect(afterRejoin.activeTrip?.passengers.map((p) => p.userId)).toEqual([ana.id]);
  });

  it('treats cancelling without having joined as a no-op', async () => {
    const { service, driver, ana, eureka } = await setup();
    await service.start(driver, eureka.id);
    expect((await service.leave(ana, eureka.id)).activeTrip?.passengers).toEqual([]);
  });

  it('rejects cancelling once the driver confirmed the stop', async () => {
    const { service, driver, ana, eureka } = await setup();
    await service.start(driver, eureka.id);
    await service.join(ana, eureka.id);
    await service.confirmStop(driver, eureka.id, ana.id);

    await expect(service.leave(ana, eureka.id)).rejects.toMatchObject({ code: 'STOP_ALREADY_CONFIRMED' });
  });

  it('rejects cancelling with no active trip or as the driver', async () => {
    const { service, driver, ana, eureka } = await setup();
    await expect(service.leave(ana, eureka.id)).rejects.toMatchObject({ code: 'NO_ACTIVE_TRIP' });
    await service.start(driver, eureka.id);
    await expect(service.leave(driver, eureka.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets the driver finish once the only pending passenger cancels', async () => {
    const { service, driver, ana, eureka } = await setup();
    await service.start(driver, eureka.id);
    await service.join(ana, eureka.id);
    await service.leave(ana, eureka.id);
    expect((await service.finish(driver, eureka.id)).activeTrip).toBeNull();
  });

  it('confirms a passenger stop', async () => {
    const { service, driver, ana, eureka } = await setup();
    await service.start(driver, eureka.id);
    await service.join(ana, eureka.id);

    const state = await service.confirmStop(driver, eureka.id, ana.id);

    expect(state.activeTrip?.passengers[0]?.confirmedAt).toEqual(new Date('2026-11-19T12:00:00Z'));
  });

  it('rejects confirming a passenger that is not in the trip', async () => {
    const { service, driver, beto, eureka } = await setup();
    await service.start(driver, eureka.id);
    await expect(service.confirmStop(driver, eureka.id, beto.id)).rejects.toMatchObject({ code: 'PASSENGER_NOT_IN_TRIP' });
  });

  it('only finishes once every stop is confirmed, then rotates the next route', async () => {
    const { service, driver, ana, beto, eureka } = await setup();
    await service.start(driver, eureka.id);
    await service.join(ana, eureka.id);
    await service.join(beto, eureka.id);
    await service.confirmStop(driver, eureka.id, ana.id);

    await expect(service.finish(driver, eureka.id)).rejects.toMatchObject({ code: 'PENDING_STOPS' });

    await service.confirmStop(driver, eureka.id, beto.id);
    const state = await service.finish(driver, eureka.id);

    expect(state).toEqual({ companyId: eureka.id, activeTrip: null, nextRoute: eureka.routes[1] });
  });

  it('allows finishing a trip nobody joined', async () => {
    const { service, driver, eureka } = await setup();
    await service.start(driver, eureka.id);
    expect(await service.finish(driver, eureka.id)).toMatchObject({ activeTrip: null, nextRoute: { name: 'Norte' } });
  });

  it('rejects finishing when no trip is active', async () => {
    const { service, driver, eureka } = await setup();
    await expect(service.finish(driver, eureka.id)).rejects.toMatchObject({ code: 'NO_ACTIVE_TRIP' });
  });

  it('rotates through all the company routes across consecutive trips', async () => {
    const { service, driver, eureka } = await setup();
    const routes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const started = await service.start(driver, eureka.id);
      routes.push(started.activeTrip!.route.name);
      await service.finish(driver, eureka.id);
    }
    expect(routes).toEqual(['Mañana', 'Norte', 'Sur', 'Mañana']);
  });

  it('keeps a running trip on its route when the route is renamed or removed meanwhile', async () => {
    const { service, driver, companies, eureka } = await setup();
    await service.start(driver, eureka.id);

    await companies.update(eureka.id, { routes: [{ name: 'Tarde', kind: 'dropoff' }] });

    const state = await service.state(eureka.id);
    expect(state.activeTrip?.route).toEqual({ name: 'Mañana', kind: 'pickup' });
    expect(state.nextRoute?.name).toBe('Tarde');
  });
});
