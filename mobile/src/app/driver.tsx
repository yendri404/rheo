import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import Animated from 'react-native-reanimated';
import { errorMessage } from '../api/client';
import type { Company, DriverPassenger, DriverState, DriverTrip, Route } from '../api/types';
import { useSelectedCompany } from '../companies/use-selected-company';
import { useDriverTracking } from '../location/use-driver-tracking';
import { useTripState } from '../realtime/use-trip-state';
import { useAuthenticated, useSession } from '../session/session-context';
import { Checkmark } from '../ui/checkmark';
import { CompanySelect } from '../ui/company-select';
import { useConfirm } from '../ui/confirm-dialog';
import { Greeting } from '../ui/greeting';
import { motion } from '../ui/motion';
import { PassengerRow } from '../ui/passenger-row';
import { PrimaryButton } from '../ui/primary-button';
import { ScreenLayout } from '../ui/screen-layout';
import { colors, fonts } from '../ui/theme';

export default function DriverRoute() {
  const { session, api } = useSession();
  if (!session || !api) return <Redirect href="/login" />;
  if (session.user.role !== 'driver') return <Redirect href="/" />;
  return <DriverScreen />;
}

/** Resolves which of the driver's companies is on screen; everything below it belongs to that company. */
function DriverScreen() {
  const { session, signOut, refreshUser } = useAuthenticated();
  const { companies } = session.user;
  const { company, ready, select } = useSelectedCompany(companies);

  if (!ready) {
    return (
      <ScreenLayout contentKey="loading" headerAlign="bottom" header={<Text style={styles.headerCaption}>Cargando…</Text>} onSignOut={signOut}>
        <ActivityIndicator color={colors.primary} />
      </ScreenLayout>
    );
  }
  if (!company) {
    return (
      <ScreenLayout
        contentKey="no-company"
        sheet="content"
        headerAlign="bottom"
        header={<Greeting name={session.user.name} />}
        onSignOut={signOut}
        footer={<PrimaryButton label="Volver a comprobar" onPress={refreshUser} />}
      >
        <Text style={styles.caption}>Tu cuenta todavía no está asignada a una empresa.</Text>
        <Text style={styles.notice}>Pídele al administrador que te registre en una para ver sus rutas.</Text>
      </ScreenLayout>
    );
  }
  // Keyed by company: switching starts from a clean screen instead of showing the previous company's trip.
  return <CompanyTrips key={company.id} company={company} companies={companies} onSelectCompany={select} />;
}

type CompanyTripsProps = { company: Company; companies: Company[]; onSelectCompany: (companyId: string) => void };

function CompanyTrips({ company, companies, onSelectCompany }: CompanyTripsProps) {
  const { session, api, signOut, refreshUser } = useAuthenticated();
  const { state, setState, connected, unavailable } = useTripState<DriverState>(session.token, api, {
    onUnauthorized: signOut,
    companyId: company.id,
    // Removed from this company while the app was open: the refreshed profile moves the driver to another one.
    onCompanyUnavailable: refreshUser,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  // Inline instead of Alert.alert, which is a no-op on web.
  const [error, setError] = useState<string | null>(null);
  // Only pickup routes share GPS; passengers of dropoff routes have no map.
  const tracking = useDriverTracking(state?.activeTrip?.route.kind === 'pickup');

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      setState((await action()) as DriverState);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const { confirm, dialog } = useConfirm();

  async function startTrip(route: Route) {
    const ok = await confirm({
      title: `¿Empezar la ruta ${route.name}?`,
      message: `Todos los pasajeros de ${company.name} recibirán una notificación y podrán anotarse.`,
      confirmLabel: 'Empezar',
    });
    if (ok) await run('start', () => api.startTrip(company.id));
  }

  async function confirmStop(passenger: DriverPassenger) {
    const ok = await confirm({
      title: `¿Confirmar parada de ${passenger.name}?`,
      // Pickup routes collect passengers; dropoff routes take them to their destination.
      message:
        state?.activeTrip?.route.kind === 'pickup'
          ? 'Confírmala solo cuando el pasajero ya esté a bordo. No se puede deshacer.'
          : 'Confírmala solo cuando el pasajero ya haya llegado a su destino. No se puede deshacer.',
      details: [passenger.address || 'Sin dirección'],
      confirmLabel: 'Confirmar',
    });
    if (ok) await run(passenger.userId, () => api.confirmStop(passenger.userId, company.id));
  }

  async function finishTrip(trip: DriverTrip) {
    const ok = await confirm({
      title: `¿Terminar la ruta ${trip.route.name}?`,
      message: 'Verifica el resumen antes de terminar. No se puede deshacer.',
      details: [
        `${trip.route.kind === 'pickup' ? 'Pasajeros recogidos' : 'Pasajeros dejados en destino'}: ${trip.passengers.length}`,
        ...(state?.nextRoute ? [`Siguiente ruta: ${state.nextRoute.name}`] : []),
      ],
      confirmLabel: 'Terminar',
    });
    if (!ok) return;
    await run('finish', async () => {
      const next = await api.finishTrip(company.id);
      setJustFinished(true);
      return next;
    });
  }

  async function askSignOut() {
    const ok = await confirm({
      title: '¿Cerrar sesión?',
      message: state?.activeTrip ? 'Hay una ruta en curso. Seguirá activa y podrás retomarla al volver a entrar.' : undefined,
      confirmLabel: 'Cerrar sesión',
    });
    if (ok) await signOut();
  }

  const errorBanner = error && (
    <Text style={styles.error} accessibilityRole="alert">
      {error}
    </Text>
  );

  if (justFinished) {
    return (
      // Mockup: big white check on the green background, short sheet with the message and "Ok".
      <ScreenLayout
        contentKey="finished"
        sheet="content"
        headerAlign="center"
        header={
          <Animated.View entering={motion.pop} style={styles.finishedIcon} accessibilityLabel="Ruta completada">
            <Checkmark size={72} strokeWidth={7} color={colors.background} />
          </Animated.View>
        }
        footer={<PrimaryButton label="Ok" onPress={() => setJustFinished(false)} />}
      >
        <Text style={styles.finishedText}>Carrera finalizada</Text>
      </ScreenLayout>
    );
  }

  const companySelect = (
    <CompanySelect
      companies={companies}
      selected={company}
      onSelect={onSelectCompany}
      // The phone shares its GPS with the route on screen, so the driver stays with it until it ends.
      lockedReason={state?.activeTrip ? 'Hay una ruta en curso. Termínala para cambiar de empresa.' : undefined}
    />
  );

  if (!state) {
    return (
      <ScreenLayout
        contentKey="loading"
        headerAlign="bottom"
        header={<Text style={styles.headerCaption}>{unavailable ? 'Sin acceso a esta empresa' : 'Cargando…'}</Text>}
        onSignOut={signOut}
        topStart={companySelect}
        connected={connected}
      >
        {unavailable ? (
          <Text style={styles.notice}>Ya no estás registrado en {company.name}. Elige otra empresa.</Text>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </ScreenLayout>
    );
  }

  const trip = state.activeTrip;
  const nextRoute = state.nextRoute;

  if (!trip) {
    return (
      // Mockup: the green area stays empty (reserved for future illustrations); the sheet hugs its content.
      <ScreenLayout
        contentKey="home"
        sheet="content"
        driftingDots
        headerAlign="bottom"
        header={<Greeting name={session.user.name} />}
        onSignOut={askSignOut}
        topStart={companySelect}
        connected={connected}
        footer={
          <PrimaryButton
            label="Empezar nueva carrera"
            loading={busy === 'start'}
            disabled={!nextRoute}
            onPress={() => nextRoute && startTrip(nextRoute)}
          />
        }
      >
        <Text style={styles.caption}>{nextRoute ? 'Siguiente ruta:' : `${company.name} todavía no tiene rutas.`}</Text>
        <Text style={styles.nextRoute} numberOfLines={1} adjustsFontSizeToFit>
          {nextRoute?.name ?? '—'}
        </Text>
        {errorBanner}
        {dialog}
      </ScreenLayout>
    );
  }

  const pending = trip.passengers.filter((passenger) => !passenger.confirmed).length;
  const status =
    trip.passengers.length === 0
      ? 'Esperando pasajeros…'
      : pending === 0
        ? 'Todas las paradas confirmadas'
        : `${pending} de ${trip.passengers.length} paradas pendientes`;

  return (
    <ScreenLayout
      contentKey={trip.id}
      headerAlign="bottom"
      onSignOut={askSignOut}
      topStart={companySelect}
      connected={connected}
      header={
        <>
          <Text style={styles.headerCaption}>Ruta:</Text>
          <Text style={styles.headerTitle} numberOfLines={1} adjustsFontSizeToFit>
            {trip.route.name}
          </Text>
          {/* Re-keyed so each count change fades in instead of snapping. */}
          <Animated.Text key={status} entering={motion.textEnter} style={styles.headerStatus}>
            {status}
          </Animated.Text>
        </>
      }
      footer={
        <PrimaryButton
          label="Terminar ruta"
          disabled={!trip.canFinish}
          loading={busy === 'finish'}
          onPress={() => finishTrip(trip)}
        />
      }
    >
      {errorBanner}
      {tracking === 'denied' && (
        <Text style={styles.notice} accessibilityRole="alert">
          Activa la ubicación para que los pasajeros vean dónde estás.
        </Text>
      )}
      {tracking === 'foreground' && (
        <Text style={styles.notice}>Tu ubicación solo se comparte mientras la app está abierta.</Text>
      )}
      {trip.passengers.length === 0 && (
        <Animated.Text entering={motion.textEnter} style={styles.empty}>
          Los pasajeros aparecerán aquí en cuanto se anoten.
        </Animated.Text>
      )}
      {/* Plain map instead of FlatList: the layout already scrolls, and a route has few passengers.
          New passengers spring in, cancelled ones slide out, and the rest glide into place. */}
      {trip.passengers.map((item) => (
        <Animated.View key={item.userId} entering={motion.rowEnter} exiting={motion.rowExit} layout={motion.rowLayout}>
          <PassengerRow
            name={item.name}
            address={item.address}
            confirmed={item.confirmed}
            loading={busy === item.userId}
            onConfirm={() => confirmStop(item)}
          />
        </Animated.View>
      ))}
      {dialog}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  headerCaption: { fontFamily: fonts.regular, fontSize: 20, color: colors.white, marginTop: 24 },
  headerTitle: { fontFamily: fonts.regular, fontSize: 40, color: colors.background },
  // Translucency lives in the color: the entering animation owns opacity.
  headerStatus: { fontFamily: fonts.regular, fontSize: 15, color: 'rgba(234, 240, 241, 0.85)', marginTop: 6 },
  caption: { fontFamily: fonts.regular, fontSize: 18, color: colors.dark, marginTop: 16 },
  // Generous bottom space mirrors the mockup's proportions (sheet ~half the screen).
  nextRoute: { fontFamily: fonts.regular, fontSize: 44, color: colors.dark, marginTop: 20, marginBottom: 120 },
  empty: { fontFamily: fonts.regular, fontSize: 14, color: colors.disabledText, textAlign: 'center', marginTop: 24 },
  error: { fontFamily: fonts.regular, fontSize: 14, color: colors.danger, marginBottom: 12 },
  notice: { fontFamily: fonts.regular, fontSize: 14, color: colors.disabledText, marginBottom: 12 },
  finishedIcon: {
    alignSelf: 'center',
    width: 168,
    height: 168,
    borderRadius: 84,
    borderWidth: 6,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishedText: {
    fontFamily: fonts.regular,
    fontSize: 32,
    color: colors.dark,
    textAlign: 'center',
    marginTop: 36,
    marginBottom: 60,
  },
});
